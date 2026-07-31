export default function Badge({ variant = 'default', children, ...rest }) {
  const variantClass = variant && variant !== 'default' ? variant : '';
  return <span className={`badge ${variantClass}`.trim()} {...rest}>{children}</span>;
}
