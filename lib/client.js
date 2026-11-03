window.__ModuleLoader__.load({
	id: "dsh-plugin-token-audit",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const h = React.createElement;

		const PORTS = [48921, 48922, 48923, 48924, 48925, 48926, 48927, 48928, 48929, 48930];
		const POLL_MS = 30000;
		const POS_KEY = "dsh.tokenAudit.pos2";
		const OPEN_KEY = "dsh.tokenAudit.open2";
		const TAB_KEY = "dsh.tokenAudit.tab2";
		const BUDGET_KEY = "dsh.tokenAudit.budget2";
		const PRICE_KEY = "dsh.tokenAudit.price";

		/* ================= SAO 配色 ================= */
		const A = {
			cyan: "#38e1ff",
			cyanDim: "rgba(56,225,255,0.55)",
			hair: "rgba(56,225,255,0.20)",
			bg: "rgba(4,16,24,0.86)",
			bgSolid: "rgba(3,12,18,0.95)",
			text: "#dff6ff",
			dim: "rgba(214,244,255,0.72)",
			dim2: "rgba(214,244,255,0.50)",
			warn: "#ffb648",
			danger: "#ff5f6d",
			ok: "#5ff2c0"
		};

		/* ================= 注入样式 ================= */
		const CSS = `
@keyframes tao-pulse { 0%,100%{opacity:.35;transform:scale(.85)} 50%{opacity:1;transform:scale(1)} }
@keyframes tao-sweep { 0%{transform:translateX(-100%)} 100%{transform:translateX(320%)} }
@keyframes tao-in { from{opacity:0;transform:scale(.94)} to{opacity:1;transform:scale(1)} }
.tao-root, .tao-root * { box-sizing: border-box; }
.tao-mono { font-family: "JetBrains Mono","Cascadia Mono",Consolas,"SF Mono",ui-monospace,monospace; font-variant-numeric: tabular-nums; }
.tao-caps { letter-spacing: .18em; text-transform: uppercase; }
.tao-pill { transition: box-shadow .18s ease, border-color .18s ease, transform .18s ease; }
.tao-pill:hover { box-shadow: 0 0 0 1px rgba(56,225,255,.55), 0 0 18px rgba(56,225,255,.35), inset 0 0 14px rgba(56,225,255,.10) !important; }
.tao-card { animation: tao-in .16s ease-out; }
.tao-row { transition: background .14s ease; }
.tao-row:hover { background: rgba(56,225,255,.07); }
.tao-tab { transition: color .14s ease, background .14s ease; }
.tao-tab:hover { color: ${A.cyan} !important; }
`;

		/* ================= 工具 ================= */
		function fmt(n) {
			if (n === null || n === undefined) return "—";
			if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
			if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
			return String(n);
		}
		function fmtDur(ms) {
			if (!ms) return "—";
			const s = Math.round(ms / 1000);
			if (s < 60) return s + "S";
			const m = Math.floor(s / 60);
			if (m < 60) return m + "M" + String(s % 60).padStart(2, "0") + "S";
			return Math.floor(m / 60) + "H" + String(m % 60).padStart(2, "0") + "M";
		}
		function barColor(ratio) {
			if (ratio >= 0.9) return A.danger;
			if (ratio >= 0.7) return A.warn;
			return A.cyan;
		}
		function todayKey() {
			const d = new Date();
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		}
		// 手动预算只对「当天」有效，避免昨天设的小值把今天压成 0
		function readManualBudget() {
			try {
				const raw = localStorage.getItem(BUDGET_KEY);
				if (!raw) return null;
				const obj = JSON.parse(raw);
				if (!obj || obj.day !== todayKey()) return null;
				const n = Number(obj.v);
				return Number.isFinite(n) && n > 0 ? n : null;
			} catch {
				return null;
			}
		}

		async function discoverPort() {
			for (const port of PORTS) {
				try {
					const res = await fetch(`http://127.0.0.1:${port}/health`, { cache: "no-store" });
					if (res.ok) {
						const body = await res.json();
						if (body && body.service === "dsh-token-audit") return port;
					}
				} catch { /* next */ }
			}
			return null;
		}

		/* ================= 角标 ================= */
		function Corners({ color }) {
			const base = { position: "absolute", width: 7, height: 7, borderColor: color, pointerEvents: "none" };
			return h("div", { style: { position: "absolute", inset: 0, pointerEvents: "none" } },
				h("div", { style: { ...base, top: -1, left: -1, borderTop: "1px solid", borderLeft: "1px solid" } }),
				h("div", { style: { ...base, top: -1, right: -1, borderTop: "1px solid", borderRight: "1px solid" } }),
				h("div", { style: { ...base, bottom: -1, left: -1, borderBottom: "1px solid", borderLeft: "1px solid" } }),
				h("div", { style: { ...base, bottom: -1, right: -1, borderBottom: "1px solid", borderRight: "1px solid" } })
			);
		}

		/* ================= 分段进度条 ================= */
		function SegBar({ ratio, color, height }) {
			const segs = 14;
			const filled = Math.round(Math.min(1, Math.max(0, ratio)) * segs);
			return h("div", { style: { display: "flex", gap: 2, height: height || 5, marginTop: 6 } },
				Array.from({ length: segs }, (_, i) =>
					h("div", {
						key: i,
						style: {
							flex: 1,
							background: i < filled ? color : "rgba(56,225,255,0.12)",
							boxShadow: i < filled ? `0 0 6px ${color}` : "none",
							transition: "background .3s ease"
						}
					})
				)
			);
		}

		/* ================= 主组件 ================= */
		function TokenAuditCard() {
			const [open, setOpen] = React.useState(() => localStorage.getItem(OPEN_KEY) === "1");
			const [tab, setTab] = React.useState(() => localStorage.getItem(TAB_KEY) || "day");
			const [data, setData] = React.useState(null);
			const [error, setError] = React.useState("");
			const [pos, setPos] = React.useState(() => {
				try {
					const raw = localStorage.getItem(POS_KEY);
					if (raw) return JSON.parse(raw);
				} catch { /* ignore */ }
				return { right: 18, bottom: 88 };
			});

			const dragRef = React.useRef(null);
			const movedRef = React.useRef(false);
			const rootRef = React.useRef(null);

			const [budgetOverride, setBudgetOverride] = React.useState(() => readManualBudget());
			const [editingBudget, setEditingBudget] = React.useState(false);

			// 单价：¥ / 百万 token。用于「余额 → 还能烧多少 token」的换算
			const [price, setPrice] = React.useState(() => {
				const raw = localStorage.getItem(PRICE_KEY);
				const n = raw ? Number(raw) : NaN;
				return Number.isFinite(n) && n > 0 ? n : 2;
			});
			const [editingPrice, setEditingPrice] = React.useState(false);

			/* 取数 */
			React.useEffect(() => {
				let alive = true;
				let port = null;
				const tick = async () => {
					try {
						if (!port) port = await discoverPort();
						if (!port) { if (alive) setError("LINK LOST"); return; }
						const res = await fetch(`http://127.0.0.1:${port}/stats`, { cache: "no-store" });
						if (!res.ok) throw new Error("HTTP " + res.status);
						const body = await res.json();
						if (alive) { setData(body); setError(""); }
					} catch (e) {
						if (alive) setError("LINK LOST");
						port = null;
					}
				};
				tick();
				const id = setInterval(tick, POLL_MS);
				return () => { alive = false; clearInterval(id); };
			}, []);

			/* 只有点 × 才收起；Esc 和点击外部都不再触发 */

			/* 拖拽 */
			const onDown = (e) => {
				dragRef.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom };
				movedRef.current = false;
			};
			const onMove = (e) => {
				const d = dragRef.current;
				if (!d) return;
				const dx = e.clientX - d.x;
				const dy = e.clientY - d.y;
				if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
				setPos({
					right: Math.max(2, d.right - dx),
					bottom: Math.max(2, d.bottom - dy)
				});
			};
			const onUp = () => {
				if (!dragRef.current) return;
				dragRef.current = null;
				localStorage.setItem(POS_KEY, JSON.stringify(pos));
			};
			const clickToggle = () => {
				if (movedRef.current) return;
				const next = !open;
				setOpen(next);
				localStorage.setItem(OPEN_KEY, next ? "1" : "0");
			};

			const used = data?.used?.today ?? 0;

			const bal = data?.balance?.ok ? data.balance : null;
			const balanceNum = bal ? Number(bal.total) : NaN;
			const hasBalance = Number.isFinite(balanceNum);
			const money = (v) => (Number.isFinite(v) ? v.toFixed(2) : "—");
			const sym = bal?.currency === "USD" ? "$" : "¥";
			const bonusNum = bal?.bonus ?? 0;
			const normalNum = bal?.normal ?? 0;

			// 容量来源优先级：手动预算 > 余额÷单价 > 插件配置的默认预算
			const manual = budgetOverride ?? 0;
			let capacity = 0;
			let source = "none";
			if (manual > 0) {
				capacity = manual;
				source = "manual";
			} else if (hasBalance && price > 0 && balanceNum > 0) {
				capacity = used + (balanceNum / price) * 1e6;
				source = "balance";
			} else if ((data?.budget?.daily ?? 0) > 0) {
				capacity = data.budget.daily;
				source = "config";
			}

			const remaining = capacity > 0 ? Math.max(0, capacity - used) : null;
			const ratio = capacity > 0 ? Math.min(1, used / capacity) : 0;
			const color = barColor(ratio);

			const commitBudget = (raw) => {
				const n = Number(String(raw).replace(/[^0-9.]/g, ""));
				if (!Number.isFinite(n) || n <= 0) {
					localStorage.removeItem(BUDGET_KEY);
					setBudgetOverride(null);
				} else {
					localStorage.setItem(BUDGET_KEY, JSON.stringify({ v: n, day: todayKey() }));
					setBudgetOverride(n);
				}
				setEditingBudget(false);
			};

			const commitPrice = (raw) => {
				const n = Number(String(raw).replace(/[^0-9.]/g, ""));
				if (!Number.isFinite(n) || n <= 0) {
					localStorage.removeItem(PRICE_KEY);
					setPrice(2);
				} else {
					localStorage.setItem(PRICE_KEY, String(n));
					setPrice(n);
				}
				setEditingPrice(false);
			};

			const anchor = { position: "fixed", right: pos.right, bottom: pos.bottom, zIndex: 2147483000 };
			const dragHandlers = {
				onPointerDown: onDown,
				onPointerMove: onMove,
				onPointerUp: onUp,
				onPointerCancel: onUp
			};

			/* ---------- 收起：胶囊 ---------- */
			if (!open) {
				return h("div", {
					ref: rootRef,
					className: "tao-root tao-pill tao-mono",
					style: {
						...anchor,
						display: "flex",
						alignItems: "center",
						gap: 7,
						height: 26,
						padding: "0 11px 0 9px",
						borderRadius: 999,
						cursor: "pointer",
						userSelect: "none",
						background: A.bg,
						border: `1px solid ${A.cyanDim}`,
						boxShadow: `0 0 0 1px rgba(0,0,0,.35), 0 0 16px rgba(56,225,255,.20), inset 0 0 12px rgba(56,225,255,.08)`,
						backdropFilter: "blur(10px)",
						color: A.text,
						fontSize: 11
					},
					...dragHandlers,
					onClick: clickToggle,
					title: "单击展开 TOKEN METER"
				},
					h("div", {
						style: {
							width: 5, height: 5, borderRadius: "50%",
							background: error ? A.danger : A.cyan,
							boxShadow: `0 0 8px ${error ? A.danger : A.cyan}`,
							animation: "tao-pulse 2.4s ease-in-out infinite"
						}
					}),
					h("span", { style: { color: A.dim, fontSize: 9, letterSpacing: ".14em" } }, "TOK"),
					h("span", { style: { fontWeight: 600, letterSpacing: ".04em" } }, fmt(used)),
					h("div", {
						style: {
							width: 34, height: 3, background: "rgba(56,225,255,.14)",
							position: "relative", overflow: "hidden"
						}
					},
						h("div", {
							style: {
								position: "absolute", inset: 0, width: `${Math.min(100, ratio * 100)}%`,
								background: color, boxShadow: `0 0 6px ${color}`
							}
						})
					)
				);
			}

			/* ---------- 展开：面板 ---------- */
			const bucket = tab === "day"
				? (data?.buckets?.days || []).slice(-7)
				: tab === "month"
					? (data?.buckets?.months || []).slice(-6)
					: (data?.buckets?.years || []);
			const maxV = Math.max(1, ...bucket.map((b) => b.tokens));

			// 跨过 00:00 后「今日」会归零，补一个昨日值，避免看起来像坏了
			const prevDay = [...(data?.buckets?.days || [])].reverse().find((d) => d.key < (data?.day || ""));

			return h("div", {
				ref: rootRef,
				className: "tao-root tao-card tao-mono",
				style: {
					...anchor,
					width: 268,
					borderRadius: 2,
					background: A.bgSolid,
					border: `1px solid ${A.cyanDim}`,
					boxShadow: `0 0 22px rgba(56,225,255,.18), inset 0 0 30px rgba(56,225,255,.05)`,
					backdropFilter: "blur(14px)",
					color: A.text,
					fontSize: 11,
					overflow: "visible"
				}
			},
				h("style", null, CSS),
				h(Corners, { color: A.cyan }),

				/* 标题栏 */
				h("div", {
					style: {
						display: "flex", alignItems: "center", gap: 7,
						padding: "7px 9px",
						borderBottom: `1px solid ${A.hair}`,
						cursor: "grab"
					},
					...dragHandlers
				},
					h("span", { style: { color: A.cyan, fontSize: 10 } }, "◈"),
					h("span", { className: "tao-caps", style: { fontSize: 9.5, color: A.cyan, fontWeight: 600 } }, "TOKEN METER"),
					h("span", { style: { flex: 1 } }),
					h("span", { style: { fontSize: 9, color: A.dim } }, data?.day?.slice(5) || "—"),
					h("span", {
						style: {
							cursor: "pointer", color: A.dim, fontSize: 13,
							paddingLeft: 6, lineHeight: 1, paddingRight: 2
						},
						onPointerDown: (e) => e.stopPropagation(),
						onMouseEnter: (e) => { e.currentTarget.style.color = A.danger; },
						onMouseLeave: (e) => { e.currentTarget.style.color = A.dim; },
						onClick: (e) => {
							e.stopPropagation();
							setOpen(false);
							localStorage.setItem(OPEN_KEY, "0");
						},
						title: "收起为胶囊"
					}, "×")
				),

				h("div", { style: { padding: "9px 10px 10px" } },

					/* 主数值 */
					h("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between" } },
						h("span", { className: "tao-caps", style: { fontSize: 9.5, color: A.dim, fontWeight: 600 } }, "USED TODAY"),
						editingBudget
							? h("input", {
								autoFocus: true,
								defaultValue: budget > 0 ? String(budget) : "",
								placeholder: "日预算，如 20000000",
								onKeyDown: (e) => {
									if (e.key === "Enter") commitBudget(e.currentTarget.value);
									if (e.key === "Escape") setEditingBudget(false);
								},
								onBlur: (e) => commitBudget(e.currentTarget.value),
								style: {
									width: 110, fontSize: 9, textAlign: "right",
									background: "rgba(56,225,255,.08)",
									border: `1px solid ${A.cyanDim}`,
									color: A.text, outline: "none", padding: "1px 4px",
									fontFamily: "inherit"
								}
							})
							: h("span", {
								style: {
									fontSize: 10, cursor: "pointer", fontWeight: 600,
									color: remaining === null ? A.dim : color,
									borderBottom: `1px dotted ${A.hair}`
								},
								title: source === "balance" ? "按余额 ÷ 单价估算；点击可改为手动预算" : "点击设置日预算",
								onClick: () => setEditingBudget(true)
							}, remaining === null
								? "SET BUDGET"
								: "LEFT " + fmt(remaining) + (source === "manual" ? "*" : source === "balance" ? "~" : ""))
					),
					h("div", {
						style: { fontSize: 25, fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1.15, marginTop: 1, color: "#eafcff" }
					}, fmt(used)),

					h(SegBar, { ratio, color }),

					/* 次级指标 */
					h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8, fontSize: 10, color: A.dim } },
						editingPrice
							? h("input", {
								autoFocus: true,
								defaultValue: String(price),
								placeholder: "¥/百万token",
								onKeyDown: (e) => {
									if (e.key === "Enter") commitPrice(e.currentTarget.value);
									if (e.key === "Escape") setEditingPrice(false);
								},
								onBlur: (e) => commitPrice(e.currentTarget.value),
								style: {
									width: 58, fontSize: 10, textAlign: "right",
									background: "rgba(56,225,255,.08)",
									border: `1px solid ${A.cyanDim}`,
									color: A.text, outline: "none", padding: "1px 4px",
									fontFamily: "inherit"
								}
							})
							: h("span", {
								style: { color: hasBalance ? A.ok : A.dim, cursor: "pointer", fontWeight: 600 },
								title: "点击设置单价（¥ / 百万 token）",
								onClick: () => setEditingPrice(true)
							}, (hasBalance ? "BAL " + sym + money(balanceNum) : "BAL —") + "  @" + price),
						h("span", { style: { color: used === 0 && prevDay?.tokens ? A.warn : A.dim } },
							"D-1 " + fmt(prevDay?.tokens ?? 0)),
						h("span", null, "ALL " + fmt(data?.used?.all))
					),

					/* 余额构成：赠金 / 充值 */
					hasBalance && (bonusNum > 0 || normalNum > 0)
						? h("div", {
							style: {
								display: "flex", gap: 10, marginTop: 3,
								fontSize: 9, color: A.dim2
							}
						},
							bonusNum > 0 ? h("span", null, "赠 " + sym + money(bonusNum)) : null,
							normalNum > 0 ? h("span", null, "充 " + sym + money(normalNum)) : null
						)
						: null,

					/* 页签 */
					h("div", {
						style: {
							display: "flex", gap: 0, marginTop: 9,
							border: `1px solid ${A.hair}`, borderRadius: 1, overflow: "hidden"
						}
					},
						[["day", "DAY"], ["month", "MON"], ["year", "YEAR"]].map(([k, label]) =>
							h("div", {
								key: k,
								className: "tao-tab",
								style: {
									flex: 1, textAlign: "center", padding: "4px 0", cursor: "pointer",
									fontSize: 9, letterSpacing: ".14em",
									color: tab === k ? "#03131b" : A.dim,
									background: tab === k ? A.cyan : "transparent",
									borderRight: k !== "year" ? `1px solid ${A.hair}` : "none"
								},
								onClick: () => { setTab(k); localStorage.setItem(TAB_KEY, k); }
							}, label)
						)
					),

					/* 柱状图 */
					h("div", { style: { display: "flex", alignItems: "flex-end", gap: 3, height: 42, marginTop: 8 } },
						bucket.length
							? bucket.map((b) => h("div", {
								key: b.key,
								title: b.key + " · " + fmt(b.tokens),
								style: {
									flex: 1, minHeight: 2,
									height: Math.max(2, (b.tokens / maxV) * 42) + "px",
									background: `linear-gradient(180deg, ${A.cyan}, rgba(56,225,255,.25))`,
									boxShadow: "0 0 6px rgba(56,225,255,.35)"
								}
							}))
							: h("div", { style: { fontSize: 9, color: A.dim } }, "NO DATA")
					),
					h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 8.5, color: A.dim2, marginTop: 3 } },
						h("span", null, bucket[0]?.key?.slice(2) || ""),
						h("span", null, bucket[bucket.length - 1]?.key?.slice(2) || "")
					),

					/* Top5 */
					h("div", {
						className: "tao-caps",
						style: {
							fontSize: 9, color: A.dim, marginTop: 12, marginBottom: 5, fontWeight: 600,
							display: "flex", justifyContent: "space-between"
						}
					},
						h("span", null, "TOP CONSUMPTION"),
						h("span", null, "×" + (data?.todayTasks ?? 0))
					),

					(data?.todayTop || []).length
						? data.todayTop.map((t, i) => h("div", {
							key: t.id,
							className: "tao-row",
							style: {
								display: "flex", alignItems: "center", gap: 6,
								padding: "4px 2px",
								borderTop: `1px solid rgba(56,225,255,.07)`
							}
						},
							h("span", { style: { fontSize: 8.5, color: A.cyan, width: 11 } }, String(i + 1).padStart(2, "0")),
							h("div", { style: { flex: 1, minWidth: 0 } },
								h("div", {
									style: {
										fontSize: 10, color: A.text,
										overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
									},
									title: t.prompt
								}, t.prompt),
								h("div", { style: { fontSize: 8.5, color: A.dim2, marginTop: 1.5 } },
									`#${t.turn} · ${fmtDur(t.durationMs)} · ${t.calls} CALLS · ${t.tools} TOOLS`
								)
							),
							h("span", { style: { fontSize: 10, color: A.cyan, fontWeight: 600 } }, fmt(t.tokens))
						))
						: h("div", { style: { fontSize: 9, color: A.dim, padding: "6px 2px" } }, "NO RECORD"),

					error ? h("div", {
						className: "tao-caps",
						style: { color: A.danger, fontSize: 8.5, marginTop: 7 }
					}, "⚠ " + error) : null
				)
			);
		}

		/* ================= 注册 ================= */
		const inject = ["slots"];

		function apply(ctx) {
			try {
				ctx.slots.inject("shell.overlay", () =>
					ctx.slots.register({ name: "shell.overlay", id: "token-audit.card" }, TokenAuditCard)
				);
			} catch (error) {
				console.error("[token-audit] 注册悬浮卡片失败：", error);
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
