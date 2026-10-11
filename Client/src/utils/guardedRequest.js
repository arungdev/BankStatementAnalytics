// Return a cleanup function that invalidates already-resolved promises as well
// as aborting the transport. Useful when switching filters or unmounting.
export function startGuardedRequest(load, onSuccess, onError) {
  const controller = new AbortController();
  let active = true;
  Promise.resolve().then(() => active ? load(controller.signal) : undefined)
    .then(data => { if (active) onSuccess(data); })
    .catch(error => { if (active) onError(error); });
  return () => { active = false; controller.abort(); };
}
