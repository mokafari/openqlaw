import type { CentralClientOptions } from "./types.js";

export async function runCentral(opts: CentralClientOptions) {
  const { render } = await import("ink");
  const React = await import("react");
  const { App } = await import("./app.js");
  const { CentralClient } = await import("./client.js");

  const client = new CentralClient(opts);
  client.start();
  await client.waitForReady();

  const { waitUntilExit } = render(React.createElement(App, { client }));
  await waitUntilExit();
  client.stop();
}
