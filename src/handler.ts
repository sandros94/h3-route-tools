import type { EventHandlerObject, EventHandlerRequest, EventHandlerWithFetch } from "h3";
import { defineHandler } from "h3";

import {
  type StandardSchemaV1,
  type OnValidateError,
  type InferOutput,
  syncValidate,
  validatedRequest,
  validatedURL,
  validateResponse,
} from "./upstream-internal/validate.ts";
import type { StringHeaders, ValidatedH3Event } from "./upstream-internal/utils.ts";

export function defineValidatedHandler<
  RequestBody extends StandardSchemaV1,
  RequestHeaders extends StandardSchemaV1,
  RequestQuery extends StandardSchemaV1,
  RouteParams extends StandardSchemaV1 = StandardSchemaV1<Record<string, string>>,
  ResponseBody extends StandardSchemaV1 = StandardSchemaV1<any>,
>(
  def: Omit<EventHandlerObject, "handler"> & {
    validate?: {
      body?: RequestBody;
      headers?: RequestHeaders;
      query?: RequestQuery;
      params?: RouteParams;
      response?: ResponseBody;
      onError?: OnValidateError;
    };
    handler: (
      event: ValidatedH3Event<
        EventHandlerRequest & {
          body: InferOutput<RequestBody>;
          query: StringHeaders<InferOutput<RequestQuery>>;
          routerParams: InferOutput<RouteParams>;
        },
        InferOutput<RouteParams>
      >,
    ) => InferOutput<ResponseBody> | Promise<InferOutput<ResponseBody>>;
  },
): EventHandlerWithFetch<EventHandlerRequest, InferOutput<ResponseBody>> {
  if (!def.validate) {
    return defineHandler(def) as EventHandlerWithFetch<
      EventHandlerRequest,
      InferOutput<ResponseBody>
    >;
  }

  const handler = defineHandler({
    ...def,
    handler: async function _validatedHandler(event) {
      // Validate route params
      if (def.validate!.params) {
        const params = event.context.params || {};
        event.context.params = syncValidate(
          "params",
          params,
          def.validate!.params,
          def.validate!.onError,
        ) as Record<string, string>;
      }

      // Validate request and URL
      (event as any) /* readonly */.req = validatedRequest(event.req, def.validate!);
      (event as any) /* readonly */.url = validatedURL(event.url, def.validate!);

      // Execute handler - context.params is validated at this point
      const result = await def.handler(
        event as ValidatedH3Event<
          EventHandlerRequest & {
            body: InferOutput<RequestBody>;
            query: StringHeaders<InferOutput<RequestQuery>>;
            routerParams: InferOutput<RouteParams>;
          },
          InferOutput<RouteParams>
        >,
      );

      // Validate response
      if (def.validate!.response) {
        return await validateResponse(
          result,
          def.validate!.response,
          def.validate!.onError as OnValidateError<"response"> | undefined,
        );
      }

      return result;
    },
  }) as EventHandlerWithFetch<EventHandlerRequest, InferOutput<ResponseBody>>;

  return handler;
}
