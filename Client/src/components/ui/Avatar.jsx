import { avatarColors, initials } from "../../utils/avatar";

/**
 * Avatar — a colored initial-circle giving merchants / counterparties a stable
 * visual identity across the Merchants and Transactions lists.
 */
export default function Avatar({ name, size = 40 }) {
  const [bg, fg] = avatarColors(name);
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.3,
        background: bg, color: fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.35, fontWeight: 800, flexShrink: 0,
        letterSpacing: '-0.02em',
      }}
    >
      {initials(name)}
    </div>
  );
}
