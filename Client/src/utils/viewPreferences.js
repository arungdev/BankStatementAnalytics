import { preferenceKey } from '@common/client/core';
export { preferenceValidators, oneOf, readViewPreference, writeViewPreference } from '@common/client/core';
export function viewPreferenceKey(user, scope, page, field) {
  return preferenceKey('bsa-view-v1', user, scope, page, field);
}
