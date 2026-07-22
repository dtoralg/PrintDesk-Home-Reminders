import { PubSub } from "@google-cloud/pubsub";

const projectId = process.env.PUBSUB_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "printdesk-local";
const topicId = process.env.PRINTDESK_REQUEST_CREATED_TOPIC ?? "request-created";
const subscriptionId = process.env.PRINTDESK_RENDER_SUBSCRIPTION ?? "render-request-created";
const pushEndpoint = process.env.PRINTDESK_RENDER_PUSH_ENDPOINT ?? "http://127.0.0.1:8082/events/request-created";

if (!process.env.PUBSUB_EMULATOR_HOST) throw new Error("PUBSUB_EMULATOR_HOST must point to the local emulator");
const pubsub = new PubSub({ projectId });
const topic = pubsub.topic(topicId);
const [topicExists] = await topic.exists();
if (!topicExists) await pubsub.createTopic(topicId);
const subscription = topic.subscription(subscriptionId);
const [subscriptionExists] = await subscription.exists();
if (!subscriptionExists) await topic.createSubscription(subscriptionId, { pushConfig: { pushEndpoint } });
console.log(JSON.stringify({ projectId, topicId, subscriptionId, pushEndpoint }, null, 2));
