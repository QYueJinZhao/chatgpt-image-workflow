(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CPQMCPDefaults = api;
})(globalThis, function () {
  "use strict";
  const HOST = "127.0.0.1",
    PORT = 38121,
    RESOURCE = "mcp-default-pairing.json";
  function validate(pairing, extensionId) {
    if (
      pairing?.version !== 1 ||
      pairing.extensionId !== extensionId ||
      !Number.isInteger(pairing.port) ||
      pairing.port < 1 ||
      pairing.port > 65535 ||
      typeof pairing.token !== "string" ||
      !/^[a-f0-9]{64}$/.test(pairing.token)
    )
      throw new Error("MCP_PAIRING_INVALID");
    return {
      version: 1,
      extensionId,
      port: pairing.port,
      token: pairing.token,
    };
  }
  return Object.freeze({ HOST, PORT, RESOURCE, validate });
});
