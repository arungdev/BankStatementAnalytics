import { Fragment as e, jsx as t, jsxs as n } from "react/jsx-runtime";
import { createContext as r, useCallback as i, useContext as a, useEffect as o, useLayoutEffect as s, useMemo as c, useRef as l, useState as u } from "react";
import { createPortal as d } from "react-dom";
import { FiCheck as f, FiChevronDown as p } from "react-icons/fi";
import m from "axios";
//#region src/utils/avatar.js
var h = [
	["#eef2ff", "#4f46e5"],
	["#ecfeff", "#0891b2"],
	["#f0fdf4", "#16a34a"],
	["#fef2f2", "#dc2626"],
	["#fffbeb", "#d97706"],
	["#faf5ff", "#9333ea"],
	["#fdf2f8", "#db2777"],
	["#eff6ff", "#2563eb"],
	["#f0fdfa", "#0d9488"]
], g = (e = "") => {
	let t = 0;
	for (let n = 0; n < e.length; n++) t = t * 31 + e.charCodeAt(n) | 0;
	return Math.abs(t);
}, _ = (e) => h[g(e || "?") % h.length], v = (e = "") => {
	let t = e.trim().split(/\s+/).filter(Boolean);
	return t.length === 0 ? "?" : t.length === 1 ? t[0].slice(0, 2).toUpperCase() : (t[0][0] + t[t.length - 1][0]).toUpperCase();
};
//#endregion
//#region src/ui/Avatar.jsx
function y({ name: e, size: n = 40 }) {
	let [r, i] = _(e);
	return /* @__PURE__ */ t("div", {
		style: {
			width: n,
			height: n,
			borderRadius: n * .3,
			background: r,
			color: i,
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			fontSize: n * .35,
			fontWeight: 800,
			flexShrink: 0,
			letterSpacing: "-0.02em"
		},
		children: v(e)
	});
}
//#endregion
//#region src/ui/Badge.jsx
function b({ variant: e = "default", children: n, ...r }) {
	return /* @__PURE__ */ t("span", {
		className: `badge ${e && e !== "default" ? e : ""}`.trim(),
		...r,
		children: n
	});
}
//#endregion
//#region src/ui/Button.jsx
function x({ variant: e = "secondary", className: n = "", children: r, ...i }) {
	return /* @__PURE__ */ t("button", {
		className: `btn ${e === "primary" ? "primary" : e === "danger" ? "danger" : ""} ${n}`.trim(),
		...i,
		children: r
	});
}
//#endregion
//#region src/ui/Drawer.jsx
var S = "ui-drawer-open", C = 0;
function w({ open: r, onClose: i, title: a, children: s, width: c = 450, onWidthChange: f, minWidth: p = 300, modal: m = !0 }) {
	let [h, g] = u(!1), [_] = u(() => ++C), v = l(i);
	return o(() => {
		v.current = i;
	}), o(() => {
		if (!r) return;
		window.dispatchEvent(new CustomEvent(S, { detail: _ }));
		let e = (e) => {
			e.detail !== _ && v.current?.();
		};
		return window.addEventListener(S, e), () => window.removeEventListener(S, e);
	}, [r, _]), o(() => {
		if (!h) return;
		let e = (e) => {
			let t = window.innerWidth - e.clientX;
			t >= p && t <= window.innerWidth - 50 && f?.(t);
		}, t = () => g(!1);
		return document.addEventListener("mousemove", e), document.addEventListener("mouseup", t), document.body.style.userSelect = "none", () => {
			document.removeEventListener("mousemove", e), document.removeEventListener("mouseup", t), document.body.style.userSelect = "";
		};
	}, [
		h,
		p,
		f
	]), r ? d(/* @__PURE__ */ n(e, { children: [m && /* @__PURE__ */ t("div", {
		className: "ui-drawer-backdrop",
		onClick: i
	}), /* @__PURE__ */ n("div", {
		className: "ui-drawer",
		style: { width: `${c}px` },
		children: [
			f && /* @__PURE__ */ t("div", {
				className: "ui-drawer-resize-handle",
				onMouseDown: () => g(!0),
				style: { backgroundColor: h ? "var(--primary)" : "transparent" }
			}),
			/* @__PURE__ */ n("div", {
				className: "ui-drawer-header",
				children: [/* @__PURE__ */ t("h2", { children: a }), /* @__PURE__ */ t("button", {
					className: "ui-drawer-close",
					onClick: i,
					children: "×"
				})]
			}),
			/* @__PURE__ */ t("div", {
				className: "ui-drawer-body",
				children: s
			})
		]
	})] }), document.body) : null;
}
//#endregion
//#region src/ui/EmptyState.jsx
function T({ icon: e, title: r, message: i, subtitle: a, action: o, compact: s = !1 }) {
	let c = i ?? a;
	return /* @__PURE__ */ n("div", {
		className: `ui-empty-state${s ? " compact" : ""}`,
		children: [
			e && /* @__PURE__ */ t("div", {
				className: "ui-empty-icon",
				children: e
			}),
			r && /* @__PURE__ */ t("p", {
				className: "ui-empty-title",
				children: r
			}),
			c && /* @__PURE__ */ t("span", {
				className: "ui-empty-message",
				children: c
			}),
			o
		]
	});
}
//#endregion
//#region src/ui/Modal.jsx
function E({ open: e, onClose: r, dismissible: i = !0, title: a, subtitle: s, width: c = 420, footer: l, zIndex: u, children: f }) {
	return o(() => {
		if (!e || !i) return;
		let t = (e) => {
			e.key === "Escape" && r?.();
		};
		return window.addEventListener("keydown", t), () => window.removeEventListener("keydown", t);
	}, [
		e,
		i,
		r
	]), e ? d(/* @__PURE__ */ t("div", {
		className: "ui-modal-backdrop",
		style: u ? { zIndex: u } : void 0,
		onClick: i ? r : void 0,
		children: /* @__PURE__ */ n("div", {
			className: "ui-modal",
			style: { width: c },
			role: "dialog",
			"aria-modal": "true",
			onClick: (e) => e.stopPropagation(),
			children: [
				(a || r && i) && /* @__PURE__ */ n("div", {
					className: `ui-modal-header${s ? " with-sub" : ""}`,
					children: [/* @__PURE__ */ n("div", {
						className: "ui-modal-header-text",
						children: [a && /* @__PURE__ */ t("h3", {
							className: "ui-modal-title",
							children: a
						}), s && /* @__PURE__ */ t("p", {
							className: "ui-modal-subtitle",
							children: s
						})]
					}), r && i && /* @__PURE__ */ t("button", {
						className: "ui-modal-close",
						onClick: r,
						"aria-label": "Close",
						title: "Close",
						children: "×"
					})]
				}),
				/* @__PURE__ */ t("div", {
					className: "ui-modal-body",
					children: f
				}),
				l && /* @__PURE__ */ t("div", {
					className: "ui-modal-footer",
					children: l
				})
			]
		})
	}), document.body) : null;
}
//#endregion
//#region src/ui/Select.jsx
var D = 240, O = 6;
function k({ options: e = [], value: r, onChange: i, placeholder: a = "Select…", disabled: c = !1 }) {
	let [d, m] = u(!1), [h, g] = u(-1), [_, v] = u(null), y = l(null), b = l(null), x = l(null), S = e.find((e) => e.value === r);
	s(() => {
		if (!d || !b.current) return;
		let e = b.current.getBoundingClientRect(), t = window.innerHeight - e.bottom - O, n = t < 160 && e.top > t, r = Math.min(D, (n ? e.top : t) - O);
		v({
			left: e.left,
			width: e.width,
			maxHeight: r,
			...n ? { bottom: window.innerHeight - e.top + O } : { top: e.bottom + O }
		});
	}, [d]), o(() => {
		if (!d) return;
		let e = (e) => {
			y.current && !y.current.contains(e.target) && m(!1);
		}, t = (e) => {
			x.current && x.current.contains(e.target) || m(!1);
		}, n = () => m(!1);
		return document.addEventListener("mousedown", e), window.addEventListener("resize", n), window.addEventListener("scroll", t, !0), () => {
			document.removeEventListener("mousedown", e), window.removeEventListener("resize", n), window.removeEventListener("scroll", t, !0);
		};
	}, [d]), o(() => {
		!d || h < 0 || x.current?.children[h]?.scrollIntoView({ block: "nearest" });
	}, [d, h]);
	let C = () => {
		c || m((t) => (t || g(e.findIndex((e) => e.value === r)), !t));
	}, w = (e) => {
		i(e.value), m(!1);
	};
	return /* @__PURE__ */ n("div", {
		ref: y,
		className: "ui-select",
		children: [/* @__PURE__ */ n("button", {
			ref: b,
			type: "button",
			className: `ui-select-trigger${d ? " open" : ""}`,
			onClick: C,
			onKeyDown: (t) => {
				if (!c) {
					if (!d) {
						[
							"ArrowDown",
							"ArrowUp",
							"Enter",
							" "
						].includes(t.key) && (t.preventDefault(), C());
						return;
					}
					t.key === "Escape" ? m(!1) : t.key === "ArrowDown" ? (t.preventDefault(), g((t) => Math.min(t + 1, e.length - 1))) : t.key === "ArrowUp" ? (t.preventDefault(), g((e) => Math.max(e - 1, 0))) : t.key === "Enter" || t.key === " " ? (t.preventDefault(), h >= 0 && h < e.length && w(e[h])) : t.key === "Tab" && m(!1);
				}
			},
			disabled: c,
			"aria-haspopup": "listbox",
			"aria-expanded": d,
			children: [/* @__PURE__ */ t("span", {
				className: `ui-select-value${S ? "" : " placeholder"}`,
				children: S ? S.label : a
			}), /* @__PURE__ */ t(p, {
				size: 15,
				className: "ui-select-caret"
			})]
		}), d && _ && /* @__PURE__ */ n("div", {
			ref: x,
			className: "ui-select-menu",
			role: "listbox",
			style: _,
			children: [e.length === 0 && /* @__PURE__ */ t("div", {
				className: "ui-select-empty",
				children: "No options"
			}), e.map((e, i) => {
				let a = e.value === r;
				return /* @__PURE__ */ n("button", {
					type: "button",
					className: `ui-select-option${a ? " active" : ""}${i === h ? " highlight" : ""}`,
					onClick: () => w(e),
					onMouseEnter: () => g(i),
					role: "option",
					"aria-selected": a,
					children: [/* @__PURE__ */ t("span", {
						className: "ui-select-option-label",
						children: e.label
					}), a && /* @__PURE__ */ t(f, {
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
function A({ checked: e = !1, onChange: n, disabled: r, label: i, describedBy: a, size: o }) {
	return /* @__PURE__ */ t("button", {
		type: "button",
		role: "switch",
		"aria-checked": e,
		"aria-label": i,
		"aria-describedby": a,
		disabled: r,
		className: `ui-switch${e ? " on" : ""}${o === "sm" ? " sm" : ""}`,
		onClick: () => n?.(!e),
		children: /* @__PURE__ */ t("span", { className: "ui-switch-thumb" })
	});
}
//#endregion
//#region src/ui/Tabs.jsx
function j({ tabs: e = [], active: r, onChange: i, variant: a = "pills" }) {
	return /* @__PURE__ */ t("div", {
		className: `ui-tabs ui-tabs--${a}`,
		role: "tablist",
		children: e.map((e) => /* @__PURE__ */ n("button", {
			role: "tab",
			"aria-selected": r === e.key,
			className: `ui-tab${r === e.key ? " active" : ""}`,
			onClick: () => i?.(e.key),
			children: [e.label, e.count != null && /* @__PURE__ */ t("span", {
				className: "ui-tab-count",
				children: e.count
			})]
		}, e.key))
	});
}
//#endregion
//#region src/hooks/usePersistedState.js
function M(e, t) {
	let [n, r] = u(() => {
		try {
			let n = localStorage.getItem(e);
			return n === null ? t : JSON.parse(n);
		} catch {
			return t;
		}
	});
	return o(() => {
		try {
			n == null ? localStorage.removeItem(e) : localStorage.setItem(e, JSON.stringify(n));
		} catch {}
	}, [e, n]), [n, r];
}
//#endregion
//#region src/theme/ThemeContext.jsx
var N = r(null), P = {
	light: "#4f46e5",
	dark: "#0f1117"
}, F = [
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
function I() {
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function L({ children: e, themeColors: n = P }) {
	let [r, i] = M("themePreference", "system"), [a, s] = u(I), [l, d] = M("fontSizePreference", "default");
	o(() => {
		let e = window.matchMedia("(prefers-color-scheme: dark)"), t = (e) => s(e.matches ? "dark" : "light");
		return e.addEventListener("change", t), () => e.removeEventListener("change", t);
	}, []);
	let f = r === "system" ? a : r;
	o(() => {
		document.documentElement.dataset.theme = f;
		let e = document.querySelector("meta[name=\"theme-color\"]");
		e && e.setAttribute("content", n[f]);
	}, [f, n]), o(() => {
		let e = F.find((e) => e.id === l) ?? F[1];
		document.documentElement.style.setProperty("--font-scale", String(e.scale));
	}, [l]);
	let p = c(() => ({
		theme: f,
		preference: r,
		setPreference: i,
		fontSize: l,
		setFontSize: d
	}), [
		f,
		r,
		i,
		l,
		d
	]);
	return /* @__PURE__ */ t(N.Provider, {
		value: p,
		children: e
	});
}
//#endregion
//#region src/theme/useTheme.js
function R() {
	return a(N);
}
//#endregion
//#region src/theme/chartTheme.js
function z(e) {
	return getComputedStyle(document.documentElement).getPropertyValue(`--${e}`).trim();
}
function B() {
	let { theme: e } = R();
	return c(() => ({
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
		].map((e) => z(`chart-${e}`)),
		grid: z("chart-grid"),
		axisTick: z("chart-tick"),
		tooltipBg: z(e === "dark" ? "surface-2" : "gray-900"),
		tooltipText: e === "dark" ? z("text-main") : "#ffffff",
		tooltipBorder: z("border-color")
	}), [e]);
}
//#endregion
//#region src/utils/notifications.js
var V = {
	icon: "/icon-192.png",
	badge: "/favicon-32.png"
};
async function H() {
	if (typeof Notification > "u") return "unsupported";
	if (Notification.permission === "default") try {
		return await Notification.requestPermission();
	} catch {
		return Notification.permission;
	}
	return Notification.permission;
}
async function U(e, t, n, r) {
	let i = await H();
	if (i !== "granted") return {
		ok: !1,
		reason: i === "unsupported" ? "unsupported" : i
	};
	try {
		let i = new Notification(e, {
			body: t,
			tag: n,
			...V,
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
//#region src/api/client.js
function W({ baseURL: e = "/api", withCredentials: t = !0, headers: n, loginPath: r = "/login", publicPaths: i, onUnauthorized: a } = {}) {
	let o = i ?? [r], s = m.create({
		baseURL: e,
		withCredentials: t,
		headers: {
			"Content-Type": "application/json",
			...n
		}
	});
	return s.interceptors.response.use((e) => e, (e) => (e.response?.status === 401 && (a ? a(e) : o.includes(window.location.pathname) || (window.location.href = r)), Promise.reject(e))), s;
}
//#endregion
//#region src/auth/AuthContext.jsx
var G = r(), K = {
	loading: !0,
	isAuthenticated: !1,
	needsSetup: !1,
	username: null,
	role: null
};
function q({ children: e, api: n, basePath: r = "/auth", adminRole: a = "Admin" }) {
	let [s, l] = u(K), d = i(() => n.get(`${r}/status`).then((e) => l({
		...e.data,
		loading: !1
	})).catch(() => l({
		...K,
		loading: !1
	})), [n, r]);
	o(() => {
		d();
	}, [d]);
	let f = c(() => {
		let e = async (e, t, i) => {
			let a = await n.post(`${r}/${e}`, {
				username: t,
				password: i
			});
			return await d(), a.data;
		};
		return {
			...s,
			isAdmin: s.role === a,
			login: (t, n) => e("login", t, n),
			setup: (t, n) => e("setup", t, n),
			register: (t, n) => e("register", t, n),
			logout: async () => {
				await n.post(`${r}/logout`), await d();
			},
			refresh: d
		};
	}, [
		s,
		n,
		r,
		a,
		d
	]);
	return /* @__PURE__ */ t(G.Provider, {
		value: f,
		children: e
	});
}
//#endregion
//#region src/auth/useAuth.js
function J() {
	let e = a(G);
	if (!e) throw Error("useAuth must be used within AuthProvider");
	return e;
}
//#endregion
//#region src/auth/AuthShell.jsx
function Y({ title: e, subtitle: r, onSubmit: i, logo: a, children: o }) {
	return /* @__PURE__ */ t("div", {
		className: "auth-page app-fade",
		children: /* @__PURE__ */ n("form", {
			onSubmit: i,
			className: "auth-card",
			children: [
				a && /* @__PURE__ */ t("div", {
					className: "auth-logo",
					children: a
				}),
				/* @__PURE__ */ t("h1", {
					className: "auth-title",
					children: e
				}),
				/* @__PURE__ */ t("p", {
					className: "auth-subtitle",
					children: r
				}),
				o
			]
		})
	});
}
function X({ label: e, ...r }) {
	return /* @__PURE__ */ n("div", {
		className: "auth-field",
		children: [/* @__PURE__ */ t("label", { children: e }), /* @__PURE__ */ t("input", {
			className: "field-input",
			...r
		})]
	});
}
function Z({ label: e, ...r }) {
	let [i, a] = u(!1);
	return /* @__PURE__ */ n("div", {
		className: "auth-field",
		children: [/* @__PURE__ */ t("label", { children: e }), /* @__PURE__ */ n("div", {
			className: "auth-password",
			children: [/* @__PURE__ */ t("input", {
				className: "field-input",
				type: i ? "text" : "password",
				...r
			}), /* @__PURE__ */ t("button", {
				type: "button",
				className: "auth-eye",
				onClick: () => a((e) => !e),
				"aria-label": i ? "Hide password" : "Show password",
				tabIndex: -1,
				children: i ? /* @__PURE__ */ n("svg", {
					width: "18",
					height: "18",
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2",
					strokeLinecap: "round",
					strokeLinejoin: "round",
					children: [
						/* @__PURE__ */ t("path", { d: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" }),
						/* @__PURE__ */ t("path", { d: "M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" }),
						/* @__PURE__ */ t("path", { d: "M14.12 14.12a3 3 0 1 1-4.24-4.24" }),
						/* @__PURE__ */ t("line", {
							x1: "1",
							y1: "1",
							x2: "23",
							y2: "23"
						})
					]
				}) : /* @__PURE__ */ n("svg", {
					width: "18",
					height: "18",
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2",
					strokeLinecap: "round",
					strokeLinejoin: "round",
					children: [/* @__PURE__ */ t("path", { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" }), /* @__PURE__ */ t("circle", {
						cx: "12",
						cy: "12",
						r: "3"
					})]
				})
			})]
		})]
	});
}
function Q({ children: e }) {
	return e ? /* @__PURE__ */ n("div", {
		className: "auth-error",
		role: "alert",
		children: [/* @__PURE__ */ n("svg", {
			width: "15",
			height: "15",
			viewBox: "0 0 24 24",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "2",
			strokeLinecap: "round",
			strokeLinejoin: "round",
			children: [
				/* @__PURE__ */ t("circle", {
					cx: "12",
					cy: "12",
					r: "10"
				}),
				/* @__PURE__ */ t("line", {
					x1: "12",
					y1: "8",
					x2: "12",
					y2: "12"
				}),
				/* @__PURE__ */ t("line", {
					x1: "12",
					y1: "16",
					x2: "12.01",
					y2: "16"
				})
			]
		}), /* @__PURE__ */ t("span", { children: e })]
	}) : null;
}
function $({ submitting: e, busyLabel: r, children: i }) {
	return /* @__PURE__ */ n("button", {
		type: "submit",
		className: "btn primary auth-submit",
		disabled: e,
		children: [e && /* @__PURE__ */ t("span", { className: "auth-spinner" }), e ? r : i]
	});
}
//#endregion
export { G as AuthContext, Q as AuthError, X as AuthField, Z as AuthPasswordField, q as AuthProvider, Y as AuthShell, $ as AuthSubmit, y as Avatar, b as Badge, x as Button, w as Drawer, T as EmptyState, F as FONT_SIZE_OPTIONS, E as Modal, k as Select, A as Switch, j as Tabs, N as ThemeContext, L as ThemeProvider, _ as avatarColors, W as createApiClient, H as ensurePermission, z as getToken, v as initials, U as showDesktopNotification, J as useAuth, B as useChartTheme, M as usePersistedState, R as useTheme };

//# sourceMappingURL=common-client.js.map