/**
 * App entry for lang-tsx fixture.
 */

import { Component } from './Component';
import { Button } from './Button';

export function App() {
  return (
    <div>
      <Component title="Hello" />
      <Button label="Submit" onClick={() => {}} />
    </div>
  );
}
