const extensionApi = globalThis.browser ?? globalThis.chrome;

extensionApi.action.onClicked.addListener(() => {
  extensionApi.tabs.create({});
});
