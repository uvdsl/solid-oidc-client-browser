// extracting this from Session.ts such that the jest tests would compile :)
export const getWorkerUrl = () => new URL('./RefreshWorker.js', import.meta.url);