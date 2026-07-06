import './ui.css';

export default function Button({ variant = 'secondary', className = '', children, ...props }) {
  const variantClass = variant === 'primary' ? 'primary' : variant === 'danger' ? 'danger' : '';
  return (
    <button className={`btn ${variantClass} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}
