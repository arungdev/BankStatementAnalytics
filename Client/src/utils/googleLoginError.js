const errors = {
  account: 'Google sign-in is unavailable for this account. Contact the server operator if your account was disabled.',
  credentials: 'Google rejected the application credentials. Ask the server administrator to check the matching Google Client ID and Client Secret.',
  correlation: 'Google could not match this sign-in to its original browser session. Start again from this site using the same browser. Do not reopen an old callback link.',
  state: 'This Google sign-in link is invalid or has expired. Start a new sign-in from this site.',
  expired: 'Google rejected an expired or already used sign-in code. Start a new sign-in. If it repeats, contact the administrator.',
  cancelled: 'Google sign-in was cancelled or access was denied.',
  network: 'The server could not contact Google. Ask the administrator to check outbound HTTPS access.',
  failed: 'Google sign-in failed. Ask the administrator to check the GoogleOAuth failure category in the server logs.',
};

export function googleLoginError(code) {
  return Object.hasOwn(errors, code) ? errors[code] : '';
}
