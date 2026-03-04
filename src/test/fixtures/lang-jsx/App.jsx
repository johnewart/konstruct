/**
 * App entry for lang-jsx fixture.
 */

import { Component } from './Component.jsx';
import { Button } from './Button.jsx';

export function App() {
  return (
    <div>
      <Component title="Hello" />
      <Button label="Submit" onClick={() => {}} />
    </div>
  );
}
