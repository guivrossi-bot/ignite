import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

// ── Exotic metals: plasma speed estimates from reference plasma cut-chart data ─
// Source: Hypertherm Exotic Metals cutting guide
// cutsLike uses exact DB material names (MS, SS, AL)
const EXOTIC_METALS = {
  "Brass":             { cutsLike: "SS",  speedMult: 0.90,  gas: "Air/Air",           note: "Rough edge and heavy dross expected. Ensure proper ventilation." },
  "Bronze":            { cutsLike: "MS",  speedMult: 0.875, gas: "O2 or N2/Air",      note: "10–25% slower than Mild Steel reference." },
  "Cast Iron":         { cutsLike: "MS",  speedMult: 0.50,  gas: "O2/Air",            note: "50% capacity reduction — use 50% of rated amperage and speed." },
  "Chrome-Moly Steel": { cutsLike: "SS",  speedMult: 1.0,   gas: "Air/Air",           note: "Avoid chromium fume exposure — adequate ventilation required." },
  "Copper":            { cutsLike: "MS",  speedMult: 0.625, gas: "O2 or N2/Air",      note: "25–50% slower than Mild Steel due to high thermal conductivity." },
  "Galvanized Steel":  { cutsLike: "MS",  speedMult: 1.0,   gas: "Air or O2/Air",     note: "Same speed as Mild Steel. Avoid zinc fume exposure." },
  "Manganese":         { cutsLike: "AL",  speedMult: 0.85,  gas: "Air/Air",           note: "Slightly slower than Aluminum reference." },
  "Magnesium":         { cutsLike: "SS",  speedMult: 1.0,   gas: "Air/Air",           note: "CUT ABOVE WATER ONLY — Magnesium reacts violently with water. Serious fire risk!", waterWarning: "above" },
  "Nickel":            { cutsLike: "SS",  speedMult: 1.0,   gas: "Air or H35/Air",    note: "Same speed as Stainless Steel." },
  "Titanium":          { cutsLike: "SS",  speedMult: 1.1,   gas: "N2 (best) / Air",   note: "Slightly faster than SS. Recommended to cut underwater — reduces fumes, HAZ and fire risk.", waterWarning: "under" },
};

// ── Reference categories ───────────────────────────────────────────────────────
// Every data row belongs to one of three source types shown in the comparator.
const REF = {
  generic:    { label: "Generic Table",        color: "#64748b", bg: "#f1f5f9" },
  official:   { label: "Manufacturer Cut Chart",color: "#7c3aed", bg: "#f5f3ff" },
  calculator: { label: "Calculator Estimate",  color: "#0891b2", bg: "#ecfeff" },
  estimated:  { label: "Exotic Est.",          color: "#d97706", bg: "#fffbeb" },
};

// Classify a DB row: Generic = platform model contains "Generic",
// otherwise Official manufacturer cut chart.
function refCat(row) {
  if (row._estimated)              return "estimated";
  if (row._source === "jetcalc")   return "calculator";
  const model = row.platform?.model ?? "";
  if (/generic/i.test(model))      return "generic";
  return "official";
}

// Manufacturer brand from platform model (for the badge label)
function refBrand(row) {
  const model = row.platform?.model ?? "";
  if (/xpr/i.test(model))          return "Hypertherm XPR";
  if (/powermax/i.test(model))     return "Hypertherm Powermax";
  if (/maxpro/i.test(model))       return "Hypertherm MAXPRO";
  if (/bodor/i.test(model))        return "Bodor";
  if (/bystronic/i.test(model))    return "Bystronic";
  if (/bysprint/i.test(model))     return "Bystronic";
  if (/amada/i.test(model))        return "Amada";
  if (/cypcut|bescutter/i.test(model)) return "Bescutter";
  if (/flow/i.test(model))         return "Flow";
  if (/omax/i.test(model))         return "OMAX";
  if (/oxyfuel/i.test(model))      return "Oxyfuel";
  return "Manufacturer";
}

// ── XPR Process Categories (from Hypertherm XPR460 instruction manual, Table 5) ─
const XPR_CATEGORY = {
  1: {
    short: "Cat 1 – PCT",
    color: "#16a34a",
    desc: "Process Core Thickness",
    detail: "The ideal working range for this process. Best combination of cut quality, speed, and consumable life. Edges are typically dross-free with minimal bevel angle. Recommended first choice for production cutting.",
  },
  2: {
    short: "Cat 2 – Thick",
    color: "#2563eb",
    desc: "Above Process Core Thickness",
    detail: "Material is thicker than PCT. Cut edges remain relatively square but expect some bottom-side dross and reduced speed. Use when cutting at the upper limit of the process range.",
  },
  3: {
    short: "Cat 3 – Thin",
    color: "#d97706",
    desc: "Below Process Core Thickness",
    detail: "Material is thinner than PCT. Speed is prioritized over edge quality. Some top-side dross possible. Acceptable for production where throughput matters more than edge precision.",
  },
  4: {
    short: "Cat 4 – Edge Start",
    color: "#dc2626",
    desc: "Edge Start Required",
    detail: "Pierce through the plate is NOT possible at this thickness. The torch MUST start from the edge of the workpiece — it cannot pierce mid-plate. Very thick material near the process limit. Significant dross and slower speed expected.",
    edgeStart: true,
  },
  5: {
    short: "Cat 5 – Sever",
    color: "#7c2d12",
    desc: "Severance Only",
    detail: "Maximum processable thickness — severance cut only. Produces a rough, unusable cut edge with heavy dross. Used only to separate material, not for finished parts. Arc penetration is not guaranteed.",
  },
};

// ── Powermax SYNC quality tiers (Hypertherm Powermax65/85/105 SYNC Cut Charts) ─
// Cartridge selection matrix colours: Optimal / Near to Optimal / Decreased
const POWERMAX_QUALITY = {
  optimal:   { short: "Optimal",      color: "#16a34a", desc: "Optimal cut quality", detail: "Best combination of cut edge quality, speed, and consumable life for this cartridge and thickness range." },
  near:      { short: "Near Optimal", color: "#d97706", desc: "Near to optimal",     detail: "Slightly outside the ideal cartridge range. Acceptable results with possible minor dross or slightly reduced edge quality." },
  decreased: { short: "Decreased",    color: "#dc2626", desc: "Decreased quality",   detail: "At or beyond the limits of this cartridge's effective range. Consider a different amperage cartridge for better cut quality." },
};

// ── JetCalc integration: waterjet speed formula (ported from JetCalc, pure JS) ─
// Source: JetCalc (industrialcuttinglabs.com/jetcalc)
// All internal math is in US Customary (inches, lb/min, PSI), outputs mm/min.

// Machine tiers → pump + orifice/nozzle configs from JetCalc constants
const JC_TIERS = [
  { id: "compact",      label: "Compact",      hp: "15–30",  kw: "11–22",  pressure: 60000, od: 0.007, nd: 0.020, af: 0.33 },
  { id: "standard",     label: "Standard",     hp: "50–60",  kw: "37–45",  pressure: 60000, od: 0.012, nd: 0.035, af: 0.92 },
  { id: "professional", label: "Professional", hp: "75",     kw: "56",     pressure: 60000, od: 0.014, nd: 0.035, af: 1.10 },
  { id: "industrial",   label: "Industrial",   hp: "100–150",kw: "75–112", pressure: 60000, od: 0.016, nd: 0.040, af: 1.30 },
];

// Machinability index map: exact DB material names → JetCalc MI
// DB uses abbreviations: MS = Mild Steel, SS = Stainless Steel, AL = Aluminum
const JC_MATERIAL_MAP = {
  // Core DB materials
  "MS":                { mi: 1.00 },   // Mild Steel (A36)
  "SS":                { mi: 0.90 },   // Stainless Steel 304
  "AL":                { mi: 2.55 },   // Aluminum (avg alloys)
  "Copper":            { mi: 1.40 },
  "Brass":             { mi: 1.40 },
  "Titanium":          { mi: 1.40 },
  "Glass":             { mi: 5.00 },
  "Granite":           { mi: 2.50 },
  "Marble":            { mi: 5.30 },
  "Plexiglas":         { mi: 10.00 },
  "Nilo":              { mi: 0.82 },   // Nickel-Iron alloy (≈ Hastelloy)
  // Exotic metals (used for JetCalc waterjet estimates when plasma data absent)
  "Bronze":            { mi: 1.38 },
  "Cast Iron":         { mi: 0.76 },
  "Chrome-Moly Steel": { mi: 0.95 },
  "Galvanized Steel":  { mi: 1.00 },
  "Manganese":         { mi: 2.50 },
  "Magnesium":         { mi: 2.91 },
  "Nickel":            { mi: 0.82 },
};

// Core JetCalc speed formula — returns mm/min for given tier + quality level
function jcSpeed(mi, thicknessMm, tier, quality) {
  if (!mi || thicknessMm <= 0) return null;
  const inToMm = 25.4;
  const t  = thicknessMm / inToMm;           // thickness in inches
  const od = tier.od, nd = tier.nd, af = tier.af;
  const cwp = tier.pressure / 1000;           // PSI → kPSI

  const effVar   = 1 + af / (2000 * Math.sqrt(cwp) * nd * nd * Math.pow(od, 0.45));
  const totalEff = 0.2 + (0.7 / effVar);
  const absVel   = (2000000 * od * od * cwp) / (5391 * od * od * Math.sqrt(cwp) + af);
  const frv      = -1.16 * Math.log(t) + 2.2 * Math.log(totalEff * absVel) + 0.3 * Math.log(od / nd);
  const qi       = 1 + (quality - 1) * (0.4 + t / (1 + t));
  const cutIpm   = 1.03 * (0.000000020624 * mi * af * Math.exp(frv)) / (qi * nd);

  const result = cutIpm * inToMm;
  return isFinite(result) && result > 0 ? Math.round(result) : null;
}

// Build JetCalc waterjet rows for current material + thickness (synchronous)
function buildJcRows(materialKey, thicknessMm) {
  const params = JC_MATERIAL_MAP[materialKey];
  if (!params || !thicknessMm) return [];
  return JC_TIERS.flatMap((tier) => {
    const q3 = jcSpeed(params.mi, thicknessMm, tier, 3);
    if (q3 == null) return [];
    const q1 = jcSpeed(params.mi, thicknessMm, tier, 1);
    const q5 = jcSpeed(params.mi, thicknessMm, tier, 5);
    return [{
      process:      "waterjet",
      feedrate_mmpm: q3,
      kerf_mm:      null,
      _source:      "jetcalc",
      _tier:        tier,
      _q1:          q1,
      _q5:          q5,
      platform:     { model: `JetCalc ${tier.label} (${tier.kw} kW)` },
      waterjet_params: { quality_level: 3, nozzle_config: `${(tier.od * 25.4).toFixed(2)}×${(tier.nd * 25.4).toFixed(2)} mm` },
    }];
  });
}

// ── Visual constants ──────────────────────────────────────────────────────────
const PROCESS_COLOR = {
  plasma:   { bg: "#fff1f0", border: "#ef4444", badge: "#ef4444", bar: "#ef4444" },
  laser:    { bg: "#eff6ff", border: "#3b82f6", badge: "#3b82f6", bar: "#3b82f6" },
  waterjet: { bg: "#ecfeff", border: "#06b6d4", badge: "#06b6d4", bar: "#06b6d4" },
  oxyfuel:  { bg: "#fff7ed", border: "#f97316", badge: "#f97316", bar: "#f97316" },
};
const PROCESS_ICON = { plasma: "⚡", laser: "🔆", waterjet: "💧", oxyfuel: "🔥" };

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtPlatform(model) {
  const m = model ?? "";
  if (/generic\s+(flow|omax)/i.test(m)) return "Generic Waterjet";
  return m.replace(/^Generic\s+/i, "");
}

function fmtLaserKw(model) {
  const m = (model ?? "").match(/(\d+(?:\.\d+)?)\s*kW/i);
  return m ? `${m[1]} kW` : "—";
}

function rowLabel(r) {
  const platform = fmtPlatform(r.platform?.model);
  if (r._source === "jetcalc") return `📐 ${platform}`;
  if (r._estimated)             return `EST ${platform}`;
  switch (r.process) {
    case "plasma":   return `${platform}${r.plasma_params?.cut_current_a != null ? ` · ${r.plasma_params.cut_current_a}A` : ""}`;
    case "laser":    return `${platform}${fmtLaserKw(r.platform?.model) !== "—" ? ` · ${fmtLaserKw(r.platform?.model)}` : ""}`;
    case "waterjet": return `${platform}${r.waterjet_params?.quality_level != null ? ` · Q${r.waterjet_params.quality_level}` : ""}`;
    default:         return platform;
  }
}

function dedupKey(row) {
  const platform = row.platform?.model ?? "";
  switch (row.process) {
    case "plasma":
      return [platform, row.plasma_params?.cut_current_a ?? "", row.plasma_params?.gas_combo ?? ""].join("|");
    case "laser":
      return [platform, row.laser_params?.cutting_mode ?? "", row.laser_params?.peak_power_w ?? ""].join("|");
    case "waterjet":
      if (row._source === "jetcalc") return `jetcalc|${row._tier?.id}`;
      return [fmtPlatform(row.platform?.model), row.waterjet_params?.quality_level ?? ""].join("|");
    default:
      return platform;
  }
}

function dedup(rows) {
  const seen = new Set();
  return rows.filter((r) => {
    const k = dedupKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Per-process column definitions ───────────────────────────────────────────
const PROCESS_COLS = {
  plasma: [
    { key: "ref",      label: "Reference",        align: "center", refTag: true },
    { key: "platform", label: "Platform",         align: "left",   render: (r) => fmtPlatform(r.platform?.model) },
    { key: "current",  label: "Current",          align: "center", render: (r) => r.plasma_params?.cut_current_a != null ? `${r.plasma_params.cut_current_a} A` : "—", pill: true },
    { key: "gas",      label: "Gas",              align: "center", render: (r) => {
      if (r._estimated) return r._estGas;
      if (r.plasma_params?.gas_combo) return r.plasma_params.gas_combo;
      const cls = r.class ?? "";
      // XPR pattern: "30Amp O2/O2" → "O2/O2"
      const xprGas = cls.match(/\d+Amp\s+(.+)/)?.[1];
      if (xprGas) return xprGas;
      // Powermax pattern: "105A Air" / "FineCut Air High Speed" → extract gas token
      const pmGas = cls.match(/\b(Air|N2|O2|H35|Argon)\b/i)?.[1];
      return pmGas ?? "—";
    }},
    { key: "cat",      label: "Category",         align: "center", processCat: true },
    { key: "speed",    label: "Speed (mm/min)",   align: "right",  speed: true },
    { key: "kerf",     label: "Kerf (mm)",        align: "right",  kerf: true },
  ],
  laser: [
    { key: "ref",      label: "Reference",        align: "center", refTag: true },
    { key: "platform", label: "Platform",         align: "left",   render: (r) => fmtPlatform(r.platform?.model) },
    { key: "kw",       label: "Laser Power",      align: "center", render: (r) => fmtLaserKw(r.platform?.model), pill: true },
    { key: "mode",     label: "Mode",             align: "center", render: (r) => r.laser_params?.cutting_mode ?? r.cut_type ?? "—" },
    { key: "speed",    label: "Speed (mm/min)",   align: "right",  speed: true },
    { key: "kerf",     label: "Kerf (mm)",        align: "right",  kerf: true },
  ],
  waterjet: [
    { key: "ref",      label: "Reference",        align: "center", refTag: true },
    { key: "platform", label: "Platform",         align: "left",   render: (r) => fmtPlatform(r.platform?.model) },
    { key: "quality",  label: "Quality",          align: "center", render: (r) => r.waterjet_params?.quality_level != null ? `Q${r.waterjet_params.quality_level}` : "—", pill: true },
    { key: "nozzle",   label: "Nozzle",           align: "center", render: (r) => r.waterjet_params?.nozzle_config ?? "—" },
    { key: "speed",    label: "Speed (mm/min)",   align: "right",  speed: true },
    { key: "kerf",     label: "Kerf (mm)",        align: "right",  kerf: true },
  ],
  oxyfuel: [
    { key: "ref",      label: "Reference",        align: "center", refTag: true },
    { key: "platform", label: "Platform",         align: "left",   render: (r) => fmtPlatform(r.platform?.model) },
    { key: "speed",    label: "Speed (mm/min)",   align: "right",  speed: true },
    { key: "kerf",     label: "Kerf (mm)",        align: "right",  kerf: true },
  ],
};

// ── Bar chart ─────────────────────────────────────────────────────────────────
function BarChart({ rows, valueKey, label, unit, ascending = false, formatVal }) {
  const vals   = rows.map((r) => ({ row: r, val: valueKey(r) })).filter((x) => x.val != null);
  const sorted = [...vals].sort((a, b) => ascending ? a.val - b.val : b.val - a.val);
  const maxVal = Math.max(...sorted.map((x) => x.val));
  const minVal = ascending ? sorted[0]?.val : null;
  if (!sorted.length) return null;

  return (
    <div style={ch.card}>
      <div style={ch.chartTitle}>{label}</div>
      <div style={ch.bars}>
        {sorted.map((x, i) => {
          const col    = PROCESS_COLOR[x.row.process] || { bar: "#94a3b8" };
          const isEst  = x.row._estimated || x.row._source === "jetcalc";
          const pct    = ascending
            ? ((maxVal - x.val) / (maxVal - (minVal ?? 0) || 1)) * 80 + 20
            : (x.val / maxVal) * 100;
          const isBest = ascending ? x.val === minVal : x.val === maxVal;
          return (
            <div key={i} style={ch.row}>
              <div style={ch.barLabel}>{rowLabel(x.row)}</div>
              <div style={ch.barTrack}>
                <div style={{
                  ...ch.barFill,
                  width: `${pct}%`,
                  background: col.bar,
                  opacity: isEst ? 0.4 : (isBest ? 1 : 0.65),
                  backgroundImage: isEst ? `repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,0.3) 3px,rgba(255,255,255,0.3) 6px)` : "none",
                }} />
              </div>
              <div style={{ ...ch.barVal, color: isBest ? col.bar : "#475569", fontWeight: isBest ? 700 : 400 }}>
                {formatVal ? formatVal(x.val) : x.val.toLocaleString()} {unit}
                {isBest && " ★"}
                {isEst && <span style={ch.estTag}> EST</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Reference tag: shows which of the 3 source categories + brand ────────────
function RefTag({ row }) {
  const cat = refCat(row);
  const ref = REF[cat];
  let label = ref.label;
  if (cat === "official")    label = refBrand(row);
  if (cat === "calculator")  label = "JetCalc";
  if (cat === "estimated")   label = `Est. (${row._estGas ? "Plasma" : "WJ"})`;
  return (
    <span style={{ ...s.refTag, background: ref.color, color: "#fff" }} title={ref.label}>
      {label}
    </span>
  );
}

// Derive a display category for Powermax SYNC rows from the class field
// "105A Air" / "85A Air" etc. → "Best Quality" badge
// "FineCut Air High Speed" → "High Speed" badge
// "FineCut Air Low Speed"  → "Low Speed" badge
function pmCatFromClass(cls) {
  if (!cls) return null;
  if (/finecut/i.test(cls)) {
    if (/high\s*speed/i.test(cls))
      return { short: "FineCut · High Speed", color: "#0891b2", desc: "FineCut High Speed", detail: "Optimised for thin material at maximum speed. Narrow kerf (0.4–0.8 mm). Uses 40–45 A. Ideal where speed and fine detail both matter." };
    if (/low\s*speed/i.test(cls))
      return { short: "FineCut · Low Speed",  color: "#7c3aed", desc: "FineCut Low Speed",  detail: "Reduced speed for improved edge squareness on thin material. Slightly wider kerf. Uses 30–45 A. Best for precision parts where edge angle matters more than throughput." };
  }
  // Standard amperage cuts: all stored speeds are "Best Quality" settings
  return { short: "Best Quality", color: "#16a34a", desc: "Best Quality (Powermax SYNC)", detail: "Settings from the official Hypertherm Powermax SYNC cut chart — Best Quality column. Provides the best combination of edge angle, minimal dross, and cut-surface finish for this cartridge and thickness." };
}

// ── Process category cell — XPR (Cat 1–5) or Powermax SYNC (quality tier) ────
function ProcessCatCell({ row }) {
  const [tip, setTip] = useState(false);

  // XPR: xpr_process_features = integer 1–5
  const xprCat = XPR_CATEGORY[row.plasma_params?.xpr_process_features];
  // Powermax SYNC: quality_tier field (future DB field)
  const pmCat  = POWERMAX_QUALITY[row.plasma_params?.quality_tier];
  // Any row tagged Edge Start (Powermax or XPR)
  const isEdge = row.cut_type === "Edge Start";
  // Powermax SYNC rows: derive category from class field
  const isPowermax = /powermax/i.test(row.platform?.model ?? "");
  const pmDerived  = isPowermax ? pmCatFromClass(row.class) : null;

  const cat = xprCat ?? (isEdge ? XPR_CATEGORY[4] : null) ?? pmCat ?? pmDerived;

  if (!cat) return <span style={{ color: "#94a3b8" }}>—</span>;

  return (
    <div style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setTip(true)}
      onMouseLeave={() => setTip(false)}>
      {/* Pill */}
      <span style={{ ...s.catPill, color: cat.color, borderColor: cat.color, cursor: "help" }}>
        {cat.edgeStart && <span style={{ marginRight: 3 }}>⚠</span>}
        {cat.short}
      </span>
      {/* Hover tooltip */}
      {tip && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)",
          background: "#1e293b", color: "#f8fafc",
          borderRadius: 8, padding: "10px 14px",
          fontSize: 12, lineHeight: 1.55,
          width: 270, zIndex: 1000,
          boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
          pointerEvents: "none",
          whiteSpace: "normal",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 5, color: cat.color, fontSize: 13 }}>{cat.desc}</div>
          <div style={{ color: "#cbd5e1" }}>{cat.detail}</div>
          {cat.edgeStart && (
            <div style={{
              marginTop: 10, padding: "5px 8px",
              background: "#dc2626", borderRadius: 5,
              fontWeight: 700, textAlign: "center", color: "#fff",
              fontSize: 11, letterSpacing: "0.05em",
            }}>
              ⚠ EDGE START — cannot pierce mid-plate
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CutComparator({ onBack }) {
  const [materials, setMaterials]         = useState([]);
  const [thicknesses, setThicknesses]     = useState([]);
  const [material, setMaterial]           = useState("");
  const [thickness, setThickness]         = useState(null);
  const [results, setResults]             = useState([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [estimatedRows, setEstimatedRows] = useState([]);

  const exoticCfg  = EXOTIC_METALS[material] ?? null;
  const jcParams   = JC_MATERIAL_MAP[material] ?? null;

  // JetCalc rows — pure formula, no async
  // For exotic metals not in JC_MATERIAL_MAP, fall back to the reference material
  const jcKey  = jcParams ? material : (exoticCfg ? exoticCfg.cutsLike : null);
  const jcRows = (jcKey && thickness) ? buildJcRows(jcKey, thickness.nominal) : [];

  // ── load distinct materials ─────────────────────────────────────────────────
  useEffect(() => {
    supabase
      .schema("cut_data")
      .rpc("distinct_materials")
      .then(({ data, error }) => {
        if (error) { setError(error.message); return; }
        setMaterials(data.map((r) => r.material));
      });
  }, []);

  // ── load thicknesses (±2% grouping) ────────────────────────────────────────
  useEffect(() => {
    if (!material) return;
    setThickness(null);
    setResults([]);
    setEstimatedRows([]);

    function applyGroups(data) {
      const raw = data.map((r) => r.thickness_mm).sort((a, b) => a - b);
      const groups = [];
      for (const t of raw) {
        const last = groups[groups.length - 1];
        if (last && Math.abs(t - last.nominal) / last.nominal <= 0.02) {
          last.values.push(t);
          last.nominal = last.values[Math.floor(last.values.length / 2)];
        } else {
          groups.push({ nominal: t, values: [t] });
        }
      }
      setThicknesses(groups);
    }

    // Try the material itself first. If it has no DB rows (exotic metals often
    // don't), fall back to the reference material from EXOTIC_METALS.
    supabase
      .schema("cut_data")
      .rpc("distinct_thicknesses", { p_material: material })
      .then(({ data, error }) => {
        if (error) { setError(error.message); return; }
        if (data && data.length > 0) {
          applyGroups(data);
        } else if (EXOTIC_METALS[material]) {
          // Exotic metal not found in DB — use reference material thicknesses
          supabase
            .schema("cut_data")
            .rpc("distinct_thicknesses", { p_material: EXOTIC_METALS[material].cutsLike })
            .then(({ data: d2, error: e2 }) => {
              if (e2) { setError(e2.message); return; }
              applyGroups(d2 || []);
            });
        }
        // else: non-exotic material truly has no data, leave thicknesses empty
      });
  }, [material]);

  // ── fetch DB results ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!material || !thickness) return;
    setLoading(true);
    setError(null);
    supabase
      .schema("cut_data")
      .from("cut_processes")
      .select(`
        process, cut_type, feedrate_mmpm, kerf_mm, thickness_mm, profile_type, class,
        platform:platforms ( model ),
        plasma_params  ( cut_current_a, gas_combo, xpr_process_features, min_viable_console ),
        laser_params   ( cutting_mode, peak_power_w ),
        waterjet_params( quality_level, nozzle_config )
      `)
      .eq("material", material)
      .in("thickness_mm", thickness.values)
      .eq("profile_type", "*")
      .order("process")
      .order("feedrate_mmpm", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setResults(data || []);
        setLoading(false);
      });
  }, [material, thickness]);

  // ── fetch exotic metal estimated plasma rows from reference material ─────────
  useEffect(() => {
    setEstimatedRows([]);
    if (!exoticCfg || !thickness) return;
    supabase
      .schema("cut_data")
      .from("cut_processes")
      .select(`
        process, feedrate_mmpm, kerf_mm, thickness_mm,
        platform:platforms ( model ),
        plasma_params ( cut_current_a, gas_combo )
      `)
      .eq("material", exoticCfg.cutsLike)
      .in("thickness_mm", thickness.values)
      .eq("process", "plasma")
      .eq("profile_type", "*")
      .order("feedrate_mmpm", { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) {
          const ref = dedup(data);
          setEstimatedRows(ref.map((r) => ({
            ...r,
            feedrate_mmpm: r.feedrate_mmpm != null ? Math.round(r.feedrate_mmpm * exoticCfg.speedMult) : null,
            _estimated: true,
            _estGas:    exoticCfg.gas,
          })));
        }
      });
  }, [material, thickness]);

  // ── Group + dedup all rows ───────────────────────────────────────────────────
  const grouped = results.reduce((acc, row) => {
    (acc[row.process] = acc[row.process] || []).push(row);
    return acc;
  }, {});
  Object.keys(grouped).forEach((p) => { grouped[p] = dedup(grouped[p]); });

  // Inject estimated plasma only when there is NO real plasma data for this material
  if (estimatedRows.length > 0 && !grouped["plasma"]) {
    grouped["plasma"] = estimatedRows;
  }
  // Inject JetCalc rows into waterjet group
  if (jcRows.length > 0) {
    grouped["waterjet"] = [...(grouped["waterjet"] || []), ...jcRows];
  }

  const allDeduped  = Object.values(grouped).flat();
  const maxSpeed    = allDeduped.length ? Math.max(...allDeduped.map((r) => r.feedrate_mmpm || 0)) : 0;
  const minKerf     = Math.min(...allDeduped.filter((r) => r.kerf_mm != null).map((r) => r.kerf_mm));
  const hasResults  = allDeduped.length > 0;
  const dbCount     = results.length > 0 ? Object.values(grouped).flat().filter((r) => !r._estimated && r._source !== "jetcalc").length : 0;

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        {onBack && <button style={s.backBtn} onClick={onBack}>← Back</button>}
        <div>
          <h1 style={s.title}>Cut Process Comparator</h1>
          <p style={s.sub}>
            Select material and thickness to compare all technologies.
            Data sources: cut-chart DB · JetCalc formula · exotic metal estimates.
          </p>
        </div>
      </div>

      {/* Selectors */}
      <div style={s.selectors}>
        <div style={s.selectWrap}>
          <label style={s.label}>Material</label>
          <select style={s.select} value={material} onChange={(e) => setMaterial(e.target.value)}>
            <option value="">— select material —</option>
            {materials.map((m) => (
              <option key={m} value={m}>
                {m}{EXOTIC_METALS[m] ? " ⚠" : ""}
                {JC_MATERIAL_MAP[m] || (EXOTIC_METALS[m] && JC_MATERIAL_MAP[EXOTIC_METALS[m]?.cutsLike]) ? " 📐" : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={s.selectWrap}>
          <label style={s.label}>Thickness</label>
          <select
            style={{ ...s.select, opacity: material ? 1 : 0.5 }}
            value={thickness ? String(thickness.nominal) : ""}
            onChange={(e) => setThickness(thicknesses.find((g) => String(g.nominal) === e.target.value) || null)}
            disabled={!material}
          >
            <option value="">— select thickness —</option>
            {thicknesses.map((grp) => (
              <option key={grp.nominal} value={grp.nominal}>
                {grp.nominal} mm
                {grp.values.length > 1 ? ` (groups ${grp.values[0]}–${grp.values[grp.values.length - 1]})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 3 reference categories legend */}
      <div style={s.sourceLegend}>
        <span style={{ ...s.refTag, background: REF.generic.color }}>Generic Table</span>
        <span style={s.sourceLegendText}>Industry reference (Flow, OMAX, generic oxyfuel)</span>
        <span style={{ ...s.refTag, background: REF.official.color }}>Manufacturer Cut Chart</span>
        <span style={s.sourceLegendText}>Official OEM data (Hypertherm XPR, Bodor, Bystronic…)</span>
        <span style={{ ...s.refTag, background: REF.calculator.color }}>Calculator Estimate</span>
        <span style={s.sourceLegendText}>JetCalc formula · industrialcuttinglabs.com/jetcalc</span>
        <span style={{ ...s.refTag, background: REF.estimated.color }}>Exotic Est.</span>
        <span style={s.sourceLegendText}>Exotic metal: reference material × speed factor</span>
      </div>

      {/* Error */}
      {error && <div style={s.error}>Error: {error}</div>}

      {/* Loading */}
      {loading && <div style={s.loading}>Loading…</div>}

      {/* Empty */}
      {!loading && material && thickness && !hasResults && !error && (
        <div style={s.empty}>
          No data found for <strong>{material}</strong> at <strong>{thickness.nominal} mm</strong>.
        </div>
      )}

      {/* Results */}
      {!loading && thickness && hasResults && (
        <div style={s.results}>
          {/* Meta row */}
          <div style={s.resultsMeta}>
            {dbCount > 0
              ? <><strong>{dbCount}</strong> cut-chart variants + </>
              : <span style={{ color: "#d97706" }}>No direct DB data — </span>}
            {jcRows.length > 0 && <><strong>{jcRows.length}</strong> JetCalc estimates + </>}
            {estimatedRows.length > 0 && <><strong>{estimatedRows.length}</strong> exotic plasma estimates</>}
            &nbsp; for <strong>{material}</strong> @ <strong>{thickness.nominal} mm</strong>
            {thickness.values.length > 1 && (
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {" "}(merged: {thickness.values.join(", ")} mm)
              </span>
            )}
            <span style={s.legend}>
              <span style={{ color: "#16a34a" }}>★ fastest</span>
              <span style={{ color: "#7c3aed" }}>◆ finest kerf</span>
            </span>
          </div>

          {/* Charts */}
          <div style={ch.grid}>
            <BarChart
              rows={allDeduped}
              valueKey={(r) => r.feedrate_mmpm}
              label="⚡ Speed comparison — all sources"
              unit="mm/min"
              ascending={false}
            />
            <BarChart
              rows={allDeduped.filter((r) => r.kerf_mm != null)}
              valueKey={(r) => r.kerf_mm}
              label="◆ Kerf width comparison"
              unit="mm"
              ascending={true}
              formatVal={(v) => v.toFixed(2)}
            />
          </div>

          {/* Detail tables per process */}
          {Object.entries(grouped).map(([process, rows]) => {
            const col  = PROCESS_COLOR[process] || { bg: "#f9fafb", border: "#6b7280", badge: "#6b7280" };
            const cols = PROCESS_COLS[process] || PROCESS_COLS.oxyfuel;
            const officialRows = rows.filter((r) => refCat(r) === "official");
            const genericRows  = rows.filter((r) => refCat(r) === "generic");
            const calcRows     = rows.filter((r) => refCat(r) === "calculator");
            const estRows      = rows.filter((r) => refCat(r) === "estimated");

            return (
              <div key={process} style={{ ...s.group, borderLeftColor: col.border, background: col.bg }}>
                {/* Group header */}
                <div style={s.groupHeader}>
                  <span style={s.groupIcon}>{PROCESS_ICON[process] || "⚙"}</span>
                  <span style={{ ...s.groupName, color: col.border }}>{process.toUpperCase()}</span>
                  {officialRows.length > 0 && (
                    <span style={{ ...s.groupBadge, background: REF.official.color }}>
                      {officialRows.length} manufacturer
                    </span>
                  )}
                  {genericRows.length > 0 && (
                    <span style={{ ...s.groupBadge, background: REF.generic.color }}>
                      {genericRows.length} generic
                    </span>
                  )}
                  {calcRows.length > 0 && (
                    <span style={{ ...s.groupBadge, background: REF.calculator.color }}>
                      {calcRows.length} JetCalc
                    </span>
                  )}
                  {estRows.length > 0 && (
                    <span style={{ ...s.groupBadge, background: REF.estimated.color }}>
                      {estRows.length} exotic est.
                    </span>
                  )}
                </div>

                {/* Table */}
                <div style={s.tableWrap}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        {cols.map((c) => (
                          <th key={c.key} style={{ ...s.th, textAlign: c.align }}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => {
                        const isFastest = row.feedrate_mmpm === maxSpeed;
                        const isFinest  = row.kerf_mm != null && row.kerf_mm === minKerf;
                        const isEst     = row._estimated;
                        const isJc      = row._source === "jetcalc";
                        const rowStyle  = isEst
                          ? s.trEst
                          : isJc
                            ? s.trJc
                            : i % 2 === 0 ? s.trEven : s.trOdd;
                        return (
                          <tr key={i} style={rowStyle}>
                            {cols.map((c) => {
                              if (c.refTag) return (
                                <td key={c.key} style={{ ...s.td, textAlign: c.align }}>
                                  <RefTag row={row} />
                                </td>
                              );
                              if (c.processCat) return (
                                <td key={c.key} style={{ ...s.td, textAlign: c.align }}>
                                  <ProcessCatCell row={row} />
                                </td>
                              );
                              if (c.speed) return (
                                <td key={c.key} style={{ ...s.td, textAlign: c.align }}>
                                  <span style={isFastest ? s.best : undefined}>
                                    {row.feedrate_mmpm != null ? row.feedrate_mmpm.toLocaleString() : "—"}
                                    {isFastest && " ★"}
                                  </span>
                                  {isJc && row._q1 != null && (
                                    <div style={s.jcRange}>Q1: {row._q1.toLocaleString()} — Q5: {row._q5?.toLocaleString()}</div>
                                  )}
                                </td>
                              );
                              if (c.kerf) return (
                                <td key={c.key} style={{ ...s.td, textAlign: c.align }}>
                                  {row.kerf_mm != null
                                    ? <span style={isFinest ? s.finestKerf : undefined}>
                                        {row.kerf_mm}{isFinest && " ◆"}
                                      </span>
                                    : <span style={{ color: "#94a3b8" }}>{isJc ? "Formula" : "—"}</span>}
                                </td>
                              );
                              if (c.pill) {
                                const val = c.render(row);
                                return (
                                  <td key={c.key} style={{ ...s.td, textAlign: c.align }}>
                                    {val !== "—"
                                      ? <span style={{ ...s.pill, borderColor: col.border, color: col.border }}>{val}</span>
                                      : "—"}
                                  </td>
                                );
                              }
                              return (
                                <td key={c.key} style={{ ...s.td, textAlign: c.align }}>
                                  {c.render(row)}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footnotes */}
                {calcRows.length > 0 && (
                  <div style={s.jcFootnote}>
                    📐 JetCalc speeds at Q3 (standard quality). Range shows Q1 (rough) → Q5 (fine).
                    Formula: JetCalc waterjet calculator · <em>industrialcuttinglabs.com/jetcalc</em>
                  </div>
                )}
                {estRows.length > 0 && exoticCfg && (
                  <div style={{
                    ...s.estFootnote,
                    ...(exoticCfg.waterWarning === "above"
                      ? { background: "#fff7ed", borderTopColor: "#f97316", color: "#7c2d12" }
                      : exoticCfg.waterWarning === "under"
                        ? { background: "#eff6ff", borderTopColor: "#3b82f6", color: "#1e3a8a" }
                        : {}),
                  }}>
                    {exoticCfg.waterWarning === "above" && "🔥 "}
                    {exoticCfg.waterWarning === "under"  && "💧 "}
                    {!exoticCfg.waterWarning             && "⚠️ "}
                    <strong>{exoticCfg.note}</strong>
                    {" — "}EST. speeds from <strong>{exoticCfg.cutsLike}</strong> cut-chart × {exoticCfg.speedMult} · Gas: {exoticCfg.gas} · Always verify with test cuts.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  page:           { minHeight: "100vh", background: "#f8fafc", padding: "32px 24px", fontFamily: "'Inter','Segoe UI',sans-serif", color: "#1e293b" },
  header:         { maxWidth: 960, margin: "0 auto 28px", display: "flex", alignItems: "flex-start", gap: 20 },
  backBtn:        { background: "none", border: "1px solid #cbd5e1", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 14, color: "#64748b", whiteSpace: "nowrap", marginTop: 6 },
  title:          { margin: "0 0 6px", fontSize: 26, fontWeight: 700, color: "#0f172a" },
  sub:            { margin: 0, fontSize: 14, color: "#64748b", lineHeight: 1.5 },
  selectors:      { maxWidth: 960, margin: "0 auto 12px", display: "flex", gap: 20, flexWrap: "wrap" },
  selectWrap:     { display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 200 },
  label:          { fontSize: 13, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" },
  select:         { padding: "10px 14px", fontSize: 15, borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", cursor: "pointer", outline: "none", color: "#1e293b" },
  sourceLegend:   { maxWidth: 960, margin: "0 auto 24px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 },
  sourceLegendText: { color: "#64748b", marginRight: 12 },
  refTag:         { fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 20, letterSpacing: "0.03em", whiteSpace: "nowrap", cursor: "default" },
  catPill:        { fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6, border: "1px solid", background: "rgba(255,255,255,0.8)", whiteSpace: "nowrap", cursor: "default" },
  error:          { maxWidth: 960, margin: "0 auto 20px", padding: "12px 16px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, color: "#dc2626", fontSize: 14 },
  loading:        { maxWidth: 960, margin: "0 auto", textAlign: "center", padding: 40, fontSize: 16, color: "#94a3b8" },
  empty:          { maxWidth: 960, margin: "0 auto", textAlign: "center", padding: 48, fontSize: 15, color: "#94a3b8", background: "#fff", borderRadius: 16, border: "1px dashed #e2e8f0" },
  results:        { maxWidth: 960, margin: "0 auto 12px", display: "flex", flexDirection: "column", gap: 20 },
  resultsMeta:    { fontSize: 14, color: "#64748b", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  legend:         { marginLeft: "auto", display: "flex", gap: 16, fontSize: 13, fontWeight: 600 },
  group:          { borderRadius: 14, borderLeft: "4px solid", overflow: "visible", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" },
  groupHeader:    { display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", flexWrap: "wrap" },
  groupIcon:      { fontSize: 20 },
  groupName:      { fontWeight: 700, fontSize: 15, letterSpacing: "0.04em" },
  groupBadge:     { color: "#fff", fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 20 },
  tableWrap:      { overflowX: "auto" },
  table:          { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th:             { padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", background: "rgba(255,255,255,0.6)", borderBottom: "1px solid rgba(0,0,0,0.06)" },
  td:             { padding: "10px 16px", color: "#1e293b" },
  trEven:         { background: "rgba(255,255,255,0.8)" },
  trOdd:          { background: "rgba(255,255,255,0.3)" },
  trEst:          { background: "#fffbeb", borderLeft: "3px solid #d97706" },
  trJc:           { background: "#ecfeff", borderLeft: "3px solid #0891b2" },
  best:           { color: "#16a34a", fontWeight: 700 },
  finestKerf:     { color: "#7c3aed", fontWeight: 700 },
  pill:           { fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 20, border: "1px solid", background: "rgba(255,255,255,0.8)" },
  jcRange:        { fontSize: 11, color: "#0891b2", marginTop: 2 },
  jcFootnote:     { padding: "10px 20px 12px", fontSize: 12, color: "#0e7490", fontStyle: "italic", borderTop: "1px solid rgba(6,182,212,0.2)", background: "rgba(236,254,255,0.5)" },
  estFootnote:    { padding: "10px 20px 12px", fontSize: 12, color: "#92400e", fontStyle: "italic", borderTop: "1px solid rgba(217,119,6,0.2)", background: "rgba(255,251,235,0.5)" },

  // Exotic banner
  exoticBanner:       { display: "flex", gap: 14, alignItems: "flex-start", borderRadius: 12, padding: "16px 20px", border: "1px solid" },
  exoticBannerDanger: { background: "#fff7ed", borderColor: "#f97316" },
  exoticBannerWarn:   { background: "#fffbeb", borderColor: "#d97706" },
  exoticBannerInfo:   { background: "#eff6ff", borderColor: "#3b82f6" },
  exoticBannerIcon:   { fontSize: 24, lineHeight: 1.2, flexShrink: 0 },
  exoticBannerTitle:  { fontWeight: 700, fontSize: 13, letterSpacing: "0.04em", marginBottom: 4 },
  exoticBannerBody:   { fontSize: 14, lineHeight: 1.5, marginBottom: 8 },
  exoticBannerMeta:   { fontSize: 12, color: "#64748b" },
};

const ch = {
  grid:       { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 },
  card:       { background: "#fff", borderRadius: 14, padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" },
  chartTitle: { fontSize: 13, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 16 },
  bars:       { display: "flex", flexDirection: "column", gap: 10 },
  row:        { display: "flex", alignItems: "center", gap: 10 },
  barLabel:   { fontSize: 12, color: "#475569", width: 170, flexShrink: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  barTrack:   { flex: 1, height: 10, background: "#f1f5f9", borderRadius: 99, overflow: "hidden" },
  barFill:    { height: "100%", borderRadius: 99, transition: "width 0.4s ease" },
  barVal:     { fontSize: 12, width: 120, textAlign: "right", flexShrink: 0 },
  estTag:     { fontSize: 10, fontWeight: 700, color: "#d97706", marginLeft: 2 },
};
