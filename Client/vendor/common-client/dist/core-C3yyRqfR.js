import e from "axios";
//#region src/api/client.js
function t({ baseURL: t = "/api", withCredentials: n = !0, headers: r, loginPath: i = "/login", publicPaths: a, onUnauthorized: o, transport: s = e, resolveLocation: c = () => globalThis.location, ...l } = {}) {
	let u = a ?? [i], d = s.create({
		...l,
		baseURL: t,
		withCredentials: n,
		headers: {
			"Content-Type": "application/json",
			...r
		}
	});
	return d.interceptors.response.use((e) => e, (e) => {
		if (e.response?.status === 401) if (o) o(e);
		else {
			let e = c();
			e && !u.includes(e.pathname) && (e.href = i);
		}
		return Promise.reject(e);
	}), d;
}
//#endregion
//#region src/utils/browserStorage.js
function n(e) {
	return {
		getItem(t) {
			try {
				return e()?.getItem(t) ?? null;
			} catch {
				return null;
			}
		},
		setItem(t, n) {
			try {
				e()?.setItem(t, n);
			} catch {}
		},
		removeItem(t) {
			try {
				e()?.removeItem(t);
			} catch {}
		}
	};
}
var r = n(() => globalThis.localStorage);
function i(e, t = r) {
	try {
		let n = JSON.parse(t.getItem(e) ?? "[]");
		return new Set(Array.isArray(n) ? n.filter((e) => typeof e == "string") : []);
	} catch {
		return /* @__PURE__ */ new Set();
	}
}
function a(e, t, n, i = r) {
	let a = [...t].filter((e) => typeof e == "string"), o = Number.isInteger(n) && n > 0 ? a.slice(-n) : a;
	i.setItem(e, JSON.stringify(o));
}
//#endregion
//#region src/utils/apiError.js
function o(e, t = "Something went wrong. Please try again.") {
	return e && !e.response ? e.code === "ECONNABORTED" || e.code === "ETIMEDOUT" ? "The server took too long to respond. Please try again." : "Can't reach the server. Check that it's running and try again." : s(e?.response?.data) || t;
}
function s(e) {
	if (typeof e == "string") {
		let t = e.trim();
		return !t || t.startsWith("<") || t.length > 300 ? null : t;
	}
	if (e && typeof e == "object") {
		let t = e.message ?? e.detail ?? e.title;
		if (typeof t == "string" && t.trim()) return t.trim();
		let n = Object.values(e.errors ?? {}).flat().find((e) => typeof e == "string" && e.trim());
		if (n) return n.trim();
	}
	return null;
}
//#endregion
//#region src/utils/guardedRequest.js
function c(e, t, n) {
	let r = new AbortController(), i = !0;
	return Promise.resolve().then(() => i ? e(r.signal) : void 0).then((e) => {
		i && t(e);
	}).catch((e) => {
		i && n(e);
	}), () => {
		i = !1, r.abort();
	};
}
//#endregion
//#region src/utils/preferences.js
var l = {
	pageSize: (e) => [
		5,
		10,
		20,
		50,
		100
	].includes(e),
	amount: (e) => e === null || typeof e == "number" && Number.isFinite(e) && e >= 0,
	width: (e) => typeof e == "number" && Number.isFinite(e) && e >= 300 && e <= 1600,
	page: (e) => Number.isInteger(e) && e >= 0 && e <= 1e5
}, u = (...e) => (t) => e.includes(t);
function d(e, t, n, r, i) {
	return [
		e,
		t || "anonymous",
		n ?? "workspace",
		r,
		i
	].map((e) => encodeURIComponent(String(e))).join(":");
}
function f(e, t) {
	return t === null ? e === null : typeof e != typeof t || e === null ? !1 : typeof e == "number" ? Number.isFinite(e) : typeof e == "string" ? e.length <= 1e3 : Array.isArray(t) ? Array.isArray(e) : typeof t == "object" ? !Array.isArray(e) && Object.keys(t).every((n) => f(e[n], t[n])) : typeof e == "boolean";
}
function p(e, t, n, r, i) {
	try {
		let a = e.getItem(t) ?? (i ? e.getItem(i) : null);
		if (a === null) return n;
		let o = JSON.parse(a);
		return (r ? r(o) : f(o, n)) ? o : n;
	} catch {
		return n;
	}
}
function m(e, t, n) {
	try {
		e.setItem(t, JSON.stringify(n));
	} catch {}
}
//#endregion
export { m as a, r as c, a as d, t as f, p as i, n as l, d as n, c as o, l as r, o as s, u as t, i as u };

//# sourceMappingURL=core-C3yyRqfR.js.map