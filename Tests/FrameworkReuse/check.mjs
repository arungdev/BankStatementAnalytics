import assert from 'node:assert/strict';

export async function check({ core, ui, React, renderToStaticMarkup, namespace, baseURL, loginPath }) {
  const client = core.createApiClient({ baseURL, loginPath, publicPaths: [loginPath] });
  client.defaults.adapter = async config => ({ data: { baseURL: config.baseURL, path: config.url }, status: 200, statusText: 'OK', headers: {}, config });
  const response = await client.get('/items');
  assert.deepEqual(response.data, { baseURL, path: '/items' });
  const data = new Map();
  const storage = core.createSafeStorage(() => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }));
  const key = core.preferenceKey(namespace, 'tester', 'workspace', 'list', 'pageSize');
  core.writeViewPreference(storage, key, 20);
  assert.equal(core.readViewPreference(storage, key, 10), 20);
  assert.match(key, new RegExp(namespace));
  const markup = renderToStaticMarkup(React.createElement(ui.Pagination, { currentPage: 1, totalPages: 3, itemsPerPage: 10, currentCount: 10, totalCount: 30, startIndex: 0, onPageChange() {} }));
  assert.match(markup, /button/);
  const field = renderToStaticMarkup(React.createElement(ui.AuthField, { label: 'External field', id: `${namespace}-field` }));
  assert.match(field, new RegExp(`for="${namespace}-field"`));
  assert.match(field, new RegExp(`id="${namespace}-field"`));
  assert.equal(typeof ui.ThemeProvider, 'function');
  assert.equal(typeof ui.AuthProvider, 'function');
  console.log(`PASS ${namespace}: installed root/core exports, injected API configuration, scoped preferences, SSR UI, accessible field, auth/theme exports`);
}
