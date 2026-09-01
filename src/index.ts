import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => c.text("annexone"));

export default app;
