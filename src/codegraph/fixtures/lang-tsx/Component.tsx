/**
 * Component for lang-tsx fixture.
 */

import Button from './Button';

interface ComponentProps {
  title: string;
}

export function Component({ title }: ComponentProps) {
  return (
    <div>
      <h1>{title}</h1>
      <Button label="Click" onClick={() => {}} />
    </div>
  );
}
