/**
 * Button component for lang-jsx fixture.
 */

export function Button({ label, onClick }) {
  return <button onClick={onClick}>{label}</button>;
}

export default Button;
