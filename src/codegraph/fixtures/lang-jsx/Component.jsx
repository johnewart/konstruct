/**
 * Component for lang-jsx fixture.
 */

import Button from './Button.jsx';

export function Component({ title }) {
  return (
    <div>
      <h1>{title}</h1>
      <Button label="Click" onClick={() => {}} />
    </div>
  );
}
