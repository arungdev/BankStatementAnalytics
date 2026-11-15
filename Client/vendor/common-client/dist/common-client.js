import { a as e, c as t, d as n, f as r, i, l as a, n as o, o as s, r as c, s as l, t as u, u as d } from "./core-C3yyRqfR.js";
import { Fragment as f, jsx as p, jsxs as m } from "react/jsx-runtime";
import { createContext as h, useCallback as g, useContext as _, useEffect as v, useId as y, useLayoutEffect as b, useMemo as x, useRef as S, useState as C } from "react";
import { createPortal as w } from "react-dom";
import { FiCheck as T, FiChevronDown as E } from "react-icons/fi";
//#region src/utils/avatar.js
var D = [
	["#eef2ff", "#4f46e5"],
	["#ecfeff", "#0891b2"],
	["#f0fdf4", "#16a34a"],
	["#fef2f2", "#dc2626"],
	["#fffbeb", "#d97706"],
	["#faf5ff", "#9333ea"],
	["#fdf2f8", "#db2777"],
	["#eff6ff", "#2563eb"],
	["#f0fdfa", "#0d9488"]
], ee = (e = "") => {
	let t = 0;
	for (let n = 0; n < e.length; n++) t = t * 31 + e.charCodeAt(n) | 0;
	return Math.abs(t);
}, O = (e) => D[ee(e || "?") % D.length], k = (e = "") => {
	let t = e.trim().split(/\s+/).filter(Boolean);
	return t.length === 0 ? "?" : t.length === 1 ? t[0].slice(0, 2).toUpperCase() : (t[0][0] + t[t.length - 1][0]).toUpperCase();
};
//#endregion
//#region src/ui/Avatar.jsx
function A({ name: e, size: t = 40 }) {
	let [n, r] = O(e);
	return /* @__PURE__ */ p("div", {
		style: {
			width: t,
			height: t,
			borderRadius: t * .3,
			background: n,
			color: r,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			fontSize: t * .35,
			fontWeight: 800,
			flexShrink: 0,
			letterSpacing: "-0.02em"
		},
		children: k(e)
	});
}
//#endregion
//#region src/ui/Badge.jsx
function j({ variant: e = "default", children: t, ...n }) {
	return /* @__PURE__ */ p("span", {
		className: `badge ${e && e !== "default" ? e : ""}`.trim(),
		...n,
		children: t
	});
}
//#endregion
//#region src/ui/Button.jsx
function M({ variant: e = "secondary", className: t = "", children: n, ...r }) {
	return /* @__PURE__ */ p("button", {
		className: `btn ${e === "primary" ? "primary" : e === "danger" ? "danger" : ""} ${t}`.trim(),
		...r,
		children: n
	});
}
//#endregion
//#region src/ui/Drawer.jsx
var N = "ui-drawer-open", te = 0;
function ne({ open: e, onClose: t, title: n, children: r, width: i = 450, onWidthChange: a, minWidth: o = 300, modal: s = !0 }) {
	let [c, l] = C(!1), [u] = C(() => ++te), d = S(t);
	return v(() => {
		d.current = t;
	}), v(() => {
		if (!e) return;
		window.dispatchEvent(new CustomEvent(N, { detail: u }));
		let t = (e) => {
			e.detail !== u && d.current?.();
		};
		return window.addEventListener(N, t), () => window.removeEventListener(N, t);
	}, [e, u]), v(() => {
		if (!c) return;
		let e = (e) => {
			let t = window.innerWidth - e.clientX;
			t >= o && t <= window.innerWidth - 50 && a?.(t);
		}, t = () => l(!1);
		return document.addEventListener("mousemove", e), document.addEventListener("mouseup", t), document.body.style.userSelect = "none", () => {
			document.removeEventListener("mousemove", e), document.removeEventListener("mouseup", t), document.body.style.userSelect = "";
		};
	}, [
		c,
		o,
		a
	]), e ? w(/* @__PURE__ */ m(f, { children: [s && /* @__PURE__ */ p("div", {
		className: "ui-drawer-backdrop",
		onClick: t
	}), /* @__PURE__ */ m("div", {
		className: "ui-drawer",
		style: { width: `${i}px` },
		children: [
			a && /* @__PURE__ */ p("div", {
				className: "ui-drawer-resize-handle",
				onMouseDown: () => l(!0),
				style: { backgroundColor: c ? "var(--primary)" : "transparent" }
			}),
			/* @__PURE__ */ m("div", {
				className: "ui-drawer-header",
				children: [/* @__PURE__ */ p("h2", { children: n }), /* @__PURE__ */ p("button", {
					className: "ui-drawer-close",
					onClick: t,
					children: "×"
				})]
			}),
			/* @__PURE__ */ p("div", {
				className: "ui-drawer-body",
				children: r
			})
		]
	})] }), document.body) : null;
}
//#endregion
//#region src/ui/EmptyState.jsx
function re({ icon: e, title: t, message: n, subtitle: r, action: i, compact: a = !1 }) {
	let o = n ?? r;
	return /* @__PURE__ */ m("div", {
		className: `ui-empty-state${a ? " compact" : ""}`,
		children: [
			e && /* @__PURE__ */ p("div", {
				className: "ui-empty-icon",
				children: e
			}),
			t && /* @__PURE__ */ p("p", {
				className: "ui-empty-title",
				children: t
			}),
			o && /* @__PURE__ */ p("span", {
				className: "ui-empty-message",
				children: o
			}),
			i
		]
	});
}
//#endregion
//#region src/ui/Modal.jsx
function P({ open: e, onClose: t, dismissible: n = !0, title: r, subtitle: i, width: a = 420, footer: o, zIndex: s, children: c }) {
	return v(() => {
		if (!e || !n) return;
		let r = (e) => {
			e.key === "Escape" && t?.();
		};
		return window.addEventListener("keydown", r), () => window.removeEventListener("keydown", r);
	}, [
		e,
		n,
		t
	]), e ? w(/* @__PURE__ */ p("div", {
		className: "ui-modal-backdrop",
		style: s ? { zIndex: s } : void 0,
		onClick: n ? t : void 0,
		children: /* @__PURE__ */ m("div", {
			className: "ui-modal",
			style: { width: a },
			role: "dialog",
			"aria-modal": "true",
			onClick: (e) => e.stopPropagation(),
			children: [
				(r || t && n) && /* @__PURE__ */ m("div", {
					className: `ui-modal-header${i ? " with-sub" : ""}`,
					children: [/* @__PURE__ */ m("div", {
						className: "ui-modal-header-text",
						children: [r && /* @__PURE__ */ p("h3", {
							className: "ui-modal-title",
							children: r
						}), i && /* @__PURE__ */ p("p", {
							className: "ui-modal-subtitle",
							children: i
						})]
					}), t && n && /* @__PURE__ */ p("button", {
						className: "ui-modal-close",
						onClick: t,
						"aria-label": "Close",
						title: "Close",
						children: "×"
					})]
				}),
				/* @__PURE__ */ p("div", {
					className: "ui-modal-body",
					children: c
				}),
				o && /* @__PURE__ */ p("div", {
					className: "ui-modal-footer",
					children: o
				})
			]
		})
	}), document.body) : null;
}
//#endregion
//#region src/ui/Select.jsx
var F = 240, I = 6;
function L({ options: e = [], value: t, onChange: n, placeholder: r = "Select…", disabled: i = !1 }) {
	let [a, o] = C(!1), [s, c] = C(-1), [l, u] = C(null), d = S(null), f = S(null), h = S(null), g = e.find((e) => e.value === t);
	b(() => {
		if (!a || !f.current) return;
		let e = f.current.getBoundingClientRect(), t = window.innerHeight - e.bottom - I, n = t < 160 && e.top > t, r = Math.min(F, (n ? e.top : t) - I);
		u({
			left: e.left,
			width: e.width,
			maxHeight: r,
			...n ? { bottom: window.innerHeight - e.top + I } : { top: e.bottom + I }
		});
	}, [a]), v(() => {
		if (!a) return;
		let e = (e) => {
			d.current && !d.current.contains(e.target) && o(!1);
		}, t = (e) => {
			h.current && h.current.contains(e.target) || o(!1);
		}, n = () => o(!1);
		return document.addEventListener("mousedown", e), window.addEventListener("resize", n), window.addEventListener("scroll", t, !0), () => {
			document.removeEventListener("mousedown", e), window.removeEventListener("resize", n), window.removeEventListener("scroll", t, !0);
		};
	}, [a]), v(() => {
		!a || s < 0 || h.current?.children[s]?.scrollIntoView({ block: "nearest" });
	}, [a, s]);
	let _ = () => {
		i || o((n) => (n || c(e.findIndex((e) => e.value === t)), !n));
	}, y = (e) => {
		n(e.value), o(!1);
	};
	return /* @__PURE__ */ m("div", {
		ref: d,
		className: "ui-select",
		children: [/* @__PURE__ */ m("button", {
			ref: f,
			type: "button",
			className: `ui-select-trigger${a ? " open" : ""}`,
			onClick: _,
			onKeyDown: (t) => {
				if (!i) {
					if (!a) {
						[
							"ArrowDown",
							"ArrowUp",
							"Enter",
							" "
						].includes(t.key) && (t.preventDefault(), _());
						return;
					}
					t.key === "Escape" ? o(!1) : t.key === "ArrowDown" ? (t.preventDefault(), c((t) => Math.min(t + 1, e.length - 1))) : t.key === "ArrowUp" ? (t.preventDefault(), c((e) => Math.max(e - 1, 0))) : t.key === "Enter" || t.key === " " ? (t.preventDefault(), s >= 0 && s < e.length && y(e[s])) : t.key === "Tab" && o(!1);
				}
			},
			disabled: i,
			"aria-haspopup": "listbox",
			"aria-expanded": a,
			children: [/* @__PURE__ */ p("span", {
				className: `ui-select-value${g ? "" : " placeholder"}`,
				children: g ? g.label : r
			}), /* @__PURE__ */ p(E, {
				size: 15,
				className: "ui-select-caret"
			})]
		}), a && l && /* @__PURE__ */ m("div", {
			ref: h,
			className: "ui-select-menu",
			role: "listbox",
			style: l,
			children: [e.length === 0 && /* @__PURE__ */ p("div", {
				className: "ui-select-empty",
				children: "No options"
			}), e.map((e, n) => {
				let r = e.value === t;
				return /* @__PURE__ */ m("button", {
					type: "button",
					className: `ui-select-option${r ? " active" : ""}${n === s ? " highlight" : ""}`,
					onClick: () => y(e),
					onMouseEnter: () => c(n),
					role: "option",
					"aria-selected": r,
					children: [/* @__PURE__ */ p("span", {
						className: "ui-select-option-label",
						children: e.label
					}), r && /* @__PURE__ */ p(T, {
						size: 14,
						style: { flexShrink: 0 }
					})]
				}, e.value);
			})]
		})]
	});
}
//#endregion
//#region src/ui/Switch.jsx
function R({ checked: e = !1, onChange: t, disabled: n, label: r, describedBy: i, size: a }) {
	return /* @__PURE__ */ p("button", {
		type: "button",
		role: "switch",
		"aria-checked": e,
		"aria-label": r,
		"aria-describedby": i,
		disabled: n,
		className: `ui-switch${e ? " on" : ""}${a === "sm" ? " sm" : ""}`,
		onClick: () => t?.(!e),
		children: /* @__PURE__ */ p("span", { className: "ui-switch-thumb" })
	});
}
//#endregion
//#region src/ui/Tabs.jsx
function z({ tabs: e = [], active: t, onChange: n, variant: r = "pills" }) {
	return /* @__PURE__ */ p("div", {
		className: `ui-tabs ui-tabs--${r}`,
		role: "tablist",
		children: e.map((e) => /* @__PURE__ */ m("button", {
			role: "tab",
			"aria-selected": t === e.key,
			className: `ui-tab${t === e.key ? " active" : ""}`,
			onClick: () => n?.(e.key),
			children: [e.label, e.count != null && /* @__PURE__ */ p("span", {
				className: "ui-tab-count",
				children: e.count
			})]
		}, e.key))
	});
}
//#endregion
//#region src/hooks/usePersistedState.js
function B(e, t) {
	let [n, r] = C(() => {
		try {
			let n = localStorage.getItem(e);
			return n === null ? t : JSON.parse(n);
		} catch {
			return t;
		}
	});
	return v(() => {
		try {
			n == null ? localStorage.removeItem(e) : localStorage.setItem(e, JSON.stringify(n));
		} catch {}
	}, [e, n]), [n, r];
}
//#endregion
//#region src/theme/ThemeContext.jsx
var V = h(null), H = {
	light: "#4f46e5",
	dark: "#0f1117"
}, U = [
	{
		id: "small",
		label: "Small",
		scale: .9
	},
	{
		id: "default",
		label: "Default",
		scale: 1
	},
	{
		id: "large",
		label: "Large",
		scale: 1.1
	},
	{
		id: "xlarge",
		label: "Extra large",
		scale: 1.2
	}
];
function W() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function G({ children: e, themeColors: t = H }) {
	let [n, r] = B("themePreference", "system"), [i, a] = C(W), [o, s] = B("fontSizePreference", "default");
	v(() => {
		let e = window.matchMedia("(prefers-color-scheme: dark)"), t = (e) => a(e.matches ? "dark" : "light");
		return e.addEventListener("change", t), () => e.removeEventListener("change", t);
	}, []);
	let c = n === "system" ? i : n;
	v(() => {
		document.documentElement.dataset.theme = c;
		let e = document.querySelector("meta[name=\"theme-color\"]");
		e && e.setAttribute("content", t[c]);
	}, [c, t]), v(() => {
		let e = U.find((e) => e.id === o) ?? U[1];
		document.documentElement.style.setProperty("--font-scale", String(e.scale));
	}, [o]);
	let l = x(() => ({
		theme: c,
		preference: n,
		setPreference: r,
		fontSize: o,
		setFontSize: s
	}), [
		c,
		n,
		r,
		o,
		s
	]);
	return /* @__PURE__ */ p(V.Provider, {
		value: l,
		children: e
	});
}
//#endregion
//#region src/theme/useTheme.js
function K() {
	return _(V);
}
//#endregion
//#region src/theme/chartTheme.js
function q(e) {
	return getComputedStyle(document.documentElement).getPropertyValue(`--${e}`).trim();
}
function J() {
	let { theme: e } = K();
	return x(() => ({
		theme: e,
		palette: [
			1,
			2,
			3,
			4,
			5,
			6,
			7,
			8
		].map((e) => q(`chart-${e}`)),
		grid: q("chart-grid"),
		axisTick: q("chart-tick"),
		tooltipBg: q(e === "dark" ? "surface-2" : "gray-900"),
		tooltipText: e === "dark" ? q("text-main") : "#ffffff",
		tooltipBorder: q("border-color")
	}), [e]);
}
//#endregion
//#region src/utils/notifications.js
var Y = {
	icon: "/icon-192.png",
	badge: "/favicon-32.png"
};
async function X() {
	if (typeof Notification > "u") return "unsupported";
	if (Notification.permission === "default") try {
		return await Notification.requestPermission();
	} catch {
		return Notification.permission;
	}
	return Notification.permission;
}
async function ie(e, t, n, r) {
	let i = await X();
	if (i !== "granted") return {
		ok: !1,
		reason: i === "unsupported" ? "unsupported" : i
	};
	try {
		let i = new Notification(e, {
			body: t,
			tag: n,
			...Y,
			...r
		});
		return i.onclick = () => {
			try {
				window.focus();
			} catch {}
		}, { ok: !0 };
	} catch (e) {
		return {
			ok: !1,
			reason: "error",
			error: String(e)
		};
	}
}
//#endregion
//#region src/auth/AuthContext.jsx
var Z = h(), Q = {
	loading: !0,
	isAuthenticated: !1,
	needsSetup: !1,
	username: null,
	role: null
};
function ae({ children: e, api: t, basePath: n = "/auth", adminRole: r = "Admin" }) {
	let [i, a] = C(Q), o = g(() => t.get(`${n}/status`).then((e) => a({
		...e.data,
		loading: !1
	})).catch(() => a({
		...Q,
		loading: !1
	})), [t, n]);
	v(() => {
		o();
	}, [o]);
	let s = x(() => {
		let e = async (e, r, i) => {
			let a = await t.post(`${n}/${e}`, {
				username: r,
				password: i
			});
			return await o(), a.data;
		};
		return {
			...i,
			isAdmin: i.role === r,
			login: (t, n) => e("login", t, n),
			setup: (t, n) => e("setup", t, n),
			register: (t, n) => e("register", t, n),
			logout: async () => {
				await t.post(`${n}/logout`), await o();
			},
			refresh: o
		};
	}, [
		i,
		t,
		n,
		r,
		o
	]);
	return /* @__PURE__ */ p(Z.Provider, {
		value: s,
		children: e
	});
}
//#endregion
//#region src/auth/useAuth.js
function oe() {
	let e = _(Z);
	if (!e) throw Error("useAuth must be used within AuthProvider");
	return e;
}
//#endregion
//#region src/auth/AuthShell.jsx
function se({ title: e, subtitle: t, onSubmit: n, logo: r, children: i }) {
	return /* @__PURE__ */ p("div", {
		className: "auth-page app-fade",
		children: /* @__PURE__ */ m("form", {
			onSubmit: n,
			className: "auth-card",
			children: [
				r && /* @__PURE__ */ p("div", {
					className: "auth-logo",
					children: r
				}),
				/* @__PURE__ */ p("h1", {
					className: "auth-title",
					children: e
				}),
				/* @__PURE__ */ p("p", {
					className: "auth-subtitle",
					children: t
				}),
				i
			]
		})
	});
}
function ce({ label: e, id: t, ...n }) {
	let r = y(), i = t ?? r;
	return /* @__PURE__ */ m("div", {
		className: "auth-field",
		children: [/* @__PURE__ */ p("label", {
			htmlFor: i,
			children: e
		}), /* @__PURE__ */ p("input", {
			className: "field-input",
			...n,
			id: i
		})]
	});
}
function le({ label: e, id: t, ...n }) {
	let r = y(), i = t ?? r, [a, o] = C(!1);
	return /* @__PURE__ */ m("div", {
		className: "auth-field",
		children: [/* @__PURE__ */ p("label", {
			htmlFor: i,
			children: e
		}), /* @__PURE__ */ m("div", {
			className: "auth-password",
			children: [/* @__PURE__ */ p("input", {
				className: "field-input",
				type: a ? "text" : "password",
				...n,
				id: i
			}), /* @__PURE__ */ p("button", {
				type: "button",
				className: "auth-eye",
				onClick: () => o((e) => !e),
				"aria-label": a ? "Hide password" : "Show password",
				children: a ? /* @__PURE__ */ m("svg", {
					width: "18",
					height: "18",
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2",
					strokeLinecap: "round",
					strokeLinejoin: "round",
					children: [
						/* @__PURE__ */ p("path", { d: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" }),
						/* @__PURE__ */ p("path", { d: "M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" }),
						/* @__PURE__ */ p("path", { d: "M14.12 14.12a3 3 0 1 1-4.24-4.24" }),
						/* @__PURE__ */ p("line", {
							x1: "1",
							y1: "1",
							x2: "23",
							y2: "23"
						})
					]
				}) : /* @__PURE__ */ m("svg", {
					width: "18",
					height: "18",
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2",
					strokeLinecap: "round",
					strokeLinejoin: "round",
					children: [/* @__PURE__ */ p("path", { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" }), /* @__PURE__ */ p("circle", {
						cx: "12",
						cy: "12",
						r: "3"
					})]
				})
			})]
		})]
	});
}
function $({ children: e }) {
	return e ? /* @__PURE__ */ m("div", {
		className: "auth-error",
		role: "alert",
		children: [/* @__PURE__ */ m("svg", {
			width: "15",
			height: "15",
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "2",
			strokeLinecap: "round",
			strokeLinejoin: "round",
			children: [
				/* @__PURE__ */ p("circle", {
					cx: "12",
					cy: "12",
					r: "10"
				}),
				/* @__PURE__ */ p("line", {
					x1: "12",
					y1: "8",
					x2: "12",
					y2: "12"
				}),
				/* @__PURE__ */ p("line", {
					x1: "12",
					y1: "16",
					x2: "12.01",
					y2: "16"
				})
			]
		}), /* @__PURE__ */ p("span", { children: e })]
	}) : null;
}
function ue({ submitting: e, busyLabel: t, children: n }) {
	return /* @__PURE__ */ m("button", {
		type: "submit",
		className: "btn primary auth-submit",
		disabled: e,
		children: [e && /* @__PURE__ */ p("span", { className: "auth-spinner" }), e ? t : n]
	});
}
//#endregion
//#region src/hooks/useAsyncResource.js
function de(e, t) {
	let [n, r] = C(0), [i, a] = C(() => ({
		load: e,
		attempt: n,
		data: t,
		loading: !0,
		hasLoaded: !1,
		error: null
	}));
	(i.load !== e || i.attempt !== n) && a({
		load: e,
		attempt: n,
		data: i.data,
		loading: !0,
		hasLoaded: i.hasLoaded,
		error: null
	}), v(() => s(e, (t) => a({
		load: e,
		attempt: n,
		data: t,
		loading: !1,
		hasLoaded: !0,
		error: null
	}), (t) => a((r) => ({
		...r,
		load: e,
		attempt: n,
		loading: !1,
		hasLoaded: !0,
		error: t
	}))), [e, n]);
	let o = g(() => r((e) => e + 1), []), c = g((t) => a((n) => n.load === e ? {
		...n,
		data: typeof t == "function" ? t(n.data) : t
	} : n), [e]);
	return {
		data: i.data,
		loading: i.loading,
		hasLoaded: i.hasLoaded,
		error: i.error,
		retry: o,
		updateData: c
	};
}
//#endregion
//#region src/ui/RequestError.jsx
function fe({ error: e, onRetry: t }) {
	return e ? /* @__PURE__ */ m("div", {
		role: "alert",
		style: {
			padding: "12px",
			marginBottom: "16px",
			border: "1px solid var(--danger)",
			borderRadius: "var(--radius-sm)",
			color: "var(--danger)"
		},
		children: [
			/* @__PURE__ */ p("span", { children: "Could not load data. Check your connection and try again." }),
			" ",
			/* @__PURE__ */ p("button", {
				className: "btn small",
				type: "button",
				onClick: t,
				children: "Retry"
			})
		]
	}) : null;
}
//#endregion
//#region src/ui/ConfirmDialog.jsx
function pe({ open: e, title: t = "Are you sure?", message: n, confirmLabel: r = "Confirm", cancelLabel: i = "Cancel", danger: a = !1, busy: o = !1, onConfirm: s, onCancel: c }) {
	return /* @__PURE__ */ p(P, {
		open: e,
		onClose: o ? void 0 : c,
		dismissible: !o,
		title: t,
		width: 440,
		footer: /* @__PURE__ */ m(f, { children: [/* @__PURE__ */ p("button", {
			className: "btn small",
			onClick: c,
			disabled: o,
			children: i
		}), /* @__PURE__ */ p("button", {
			className: `btn small ${a ? "danger" : "primary"}`,
			onClick: s,
			disabled: o,
			children: o ? "Working…" : r
		})] }),
		children: String(n || "").split("\n\n").map((e, t) => /* @__PURE__ */ p("p", {
			className: "confirm-dialog-text",
			children: e
		}, t))
	});
}
//#endregion
//#region src/ui/Pagination.jsx
var me = [
	5,
	10,
	20,
	50,
	100
];
function he({ currentPage: e, totalPages: t, itemsPerPage: n, currentCount: r, totalCount: i, startIndex: a, itemLabel: o = "items", onPageChange: s, onItemsPerPageChange: c, loading: l = !1 }) {
	return i === 0 ? null : /* @__PURE__ */ m("div", {
		className: "pagination-bar",
		style: {
			display: "flex",
			justifyContent: "space-between",
			alignItems: "center",
			flexWrap: "wrap",
			gap: "12px",
			marginTop: "16px",
			padding: "12px 16px",
			background: "var(--surface)",
			borderRadius: "8px",
			border: "1px solid var(--border-color)"
		},
		children: [/* @__PURE__ */ m("div", {
			className: "pagination-info",
			style: {
				display: "flex",
				alignItems: "center",
				gap: "16px",
				flexWrap: "wrap"
			},
			children: [c && i > 5 && /* @__PURE__ */ m("div", {
				style: {
					fontSize: "13px",
					color: "var(--text-muted)",
					display: "flex",
					alignItems: "center",
					gap: "8px"
				},
				children: [/* @__PURE__ */ p("span", { children: "Items per page:" }), /* @__PURE__ */ p("select", {
					value: n,
					disabled: l,
					onChange: (e) => c(Number(e.target.value)),
					style: {
						padding: "4px 8px",
						borderRadius: "4px",
						border: "1px solid var(--border-color)",
						fontSize: "13px",
						outline: "none",
						background: "var(--surface-2)",
						color: "var(--text-main)"
					},
					children: me.map((e) => /* @__PURE__ */ p("option", {
						value: e,
						children: e
					}, e))
				})]
			}), /* @__PURE__ */ p("div", {
				style: {
					fontSize: "13px",
					color: "var(--text-muted)"
				},
				children: t > 1 ? /* @__PURE__ */ m(f, { children: [
					"Showing ",
					/* @__PURE__ */ p("span", {
						style: {
							fontWeight: 600,
							color: "var(--text-main)"
						},
						children: r > 0 ? a + 1 : 0
					}),
					" to ",
					/* @__PURE__ */ p("span", {
						style: {
							fontWeight: 600,
							color: "var(--text-main)"
						},
						children: a + r
					}),
					" of ",
					/* @__PURE__ */ p("span", {
						style: {
							fontWeight: 600,
							color: "var(--text-main)"
						},
						children: i
					}),
					" ",
					o
				] }) : /* @__PURE__ */ m(f, { children: [
					/* @__PURE__ */ p("span", {
						style: {
							fontWeight: 600,
							color: "var(--text-main)"
						},
						children: i
					}),
					" ",
					o.replace(/s$/, ""),
					i === 1 ? "" : "s"
				] })
			})]
		}), t > 1 && /* @__PURE__ */ m("div", {
			className: "pagination-nav",
			style: {
				display: "flex",
				gap: "8px",
				alignItems: "center"
			},
			children: [
				/* @__PURE__ */ p("button", {
					className: "btn small",
					disabled: l || e === 1,
					onClick: () => s(Math.max(1, e - 1)),
					children: "Previous"
				}),
				/* @__PURE__ */ m("span", {
					style: {
						fontSize: "13px",
						fontWeight: 600,
						color: "var(--text-main)",
						padding: "0 8px",
						whiteSpace: "nowrap"
					},
					children: [
						"Page ",
						e,
						" of ",
						t
					]
				}),
				/* @__PURE__ */ p("button", {
					className: "btn small",
					disabled: l || e >= t || t === 0,
					onClick: () => s(Math.min(t || 1, e + 1)),
					children: "Next"
				})
			]
		})]
	});
}
//#endregion
//#region src/hooks/usePreference.js
function ge(n, r, { storage: a = t, validate: o, legacyKey: s } = {}) {
	let c = typeof r == "function" ? r() : r, l = () => i(a, n, c, o, s), [u, d] = C(() => ({
		key: n,
		storage: a,
		value: l()
	})), f = u;
	(u.key !== n || u.storage !== a) && (f = {
		key: n,
		storage: a,
		value: l()
	}, d(f)), v(() => {
		e(f.storage, f.key, f.value);
	}, [
		f.storage,
		f.key,
		f.value
	]);
	let p = g((e) => {
		d((t) => {
			if (t.key !== n || t.storage !== a) return t;
			let r = typeof e == "function" ? e(t.value) : e;
			return Object.is(r, t.value) ? t : {
				key: n,
				storage: a,
				value: r
			};
		});
	}, [n, a]);
	return [f.value, p];
}
//#endregion
export { Z as AuthContext, $ as AuthError, ce as AuthField, le as AuthPasswordField, ae as AuthProvider, se as AuthShell, ue as AuthSubmit, A as Avatar, j as Badge, M as Button, pe as ConfirmDialog, ne as Drawer, re as EmptyState, U as FONT_SIZE_OPTIONS, P as Modal, he as Pagination, fe as RequestError, L as Select, R as Switch, z as Tabs, V as ThemeContext, G as ThemeProvider, l as apiErrorMessage, O as avatarColors, t as browserStorage, r as createApiClient, a as createSafeStorage, X as ensurePermission, q as getToken, k as initials, u as oneOf, o as preferenceKey, c as preferenceValidators, d as readStoredStringSet, i as readViewPreference, ie as showDesktopNotification, s as startGuardedRequest, de as useAsyncResource, oe as useAuth, J as useChartTheme, B as usePersistedState, ge as usePreference, K as useTheme, n as writeStoredStringSet, e as writeViewPreference };

//# sourceMappingURL=common-client.js.map