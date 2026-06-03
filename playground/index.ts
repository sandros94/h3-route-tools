import { H3 } from "h3";

const app = new H3();

app.on("get", "/hello", () => "Hello World!");
