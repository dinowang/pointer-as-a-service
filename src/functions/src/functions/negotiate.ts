import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { WebPubSubServiceClient } from "@azure/web-pubsub";
import { randomUUID } from "crypto";

const connectionString = process.env.WEB_PUBSUB_CONNECTION_STRING!;
const hubName = process.env.WEB_PUBSUB_HUB_NAME || "pointer";

app.http("negotiate", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: negotiate,
});

async function negotiate(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const url = new URL(request.url);
  const token = url.searchParams.get("id") || randomUUID();

  const serviceClient = new WebPubSubServiceClient(connectionString, hubName);

  const clientAccessUrl = await serviceClient.getClientAccessUrl({
    roles: [
      `webpubsub.joinLeaveGroup.${token}`,
      `webpubsub.sendToGroup.${token}`,
    ],
  });

  context.log(`Negotiate called for token: ${token}`);

  return {
    jsonBody: {
      url: clientAccessUrl,
      token,
    },
    headers: {
      "Content-Type": "application/json",
    },
  };
}
