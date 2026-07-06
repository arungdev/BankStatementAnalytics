export default function Badge({ variant = 'default', children }) {
  const variantClass = variant && variant !== 'default' ? variant : '';
  return <span className={`badge ${variantClass}`.trim()}>{children}</span>;
}
