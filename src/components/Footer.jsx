const ICL_URL = "https://www.industrialcuttinglabs.com/";
const NEWSLETTER_URL = "https://www.linkedin.com/build-relation/newsletter-follow?entityUrn=7419724116267520000";
const PROFILE_URL = "https://www.linkedin.com/in/guivrossi/";

const ACCENT   = "#00bcd4";
const BG       = "rgba(10,25,41,0.97)";
const BORDER   = "rgba(0,188,212,0.18)";
const MUTED    = "#90a4ae";
const SEP      = "rgba(0,188,212,0.25)";

const partOf = {
  en: "Part of",
  es: "Parte de",
  pt: "Parte do",
};

export default function Footer({ lang = "en" }) {
  return (
    <footer style={{
      borderTop: `1px solid ${BORDER}`,
      padding: "18px 32px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: "12px",
      background: BG,
      fontSize: "12px",
    }}>

      {/* Left — brand + ICL */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "18px" }}>⚡</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: "13px", color: ACCENT, letterSpacing: "1px" }}>
            IGNITE
          </div>
          <div style={{ color: MUTED, fontSize: "11px" }}>
            {partOf[lang] || partOf.en}{" "}
            <a
              href={ICL_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: ACCENT, textDecoration: "none", fontWeight: 600 }}
            >
              Industrial Cutting Labs
            </a>
          </div>
        </div>
      </div>

      {/* Right — links */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
        <a href={NEWSLETTER_URL} target="_blank" rel="noreferrer"
          style={{ color: MUTED, textDecoration: "none" }}>
          📰 Newsletter
        </a>
        <span style={{ color: SEP }}>|</span>
        <a href={PROFILE_URL} target="_blank" rel="noreferrer"
          style={{ color: MUTED, textDecoration: "none" }}>
          💬 {lang === "pt" ? "Entre em contato" : lang === "es" ? "Contáctame" : "Get in touch"}
        </a>
        <span style={{ color: SEP }}>|</span>
        <span style={{ color: MUTED }}>© 2025 Gui Rossi</span>
      </div>

    </footer>
  );
}
