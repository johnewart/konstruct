/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark';
import type { Components } from 'react-markdown';

const SYNTAX_BLOCK_ATTR = 'data-syntax-highlight-block';

/**
 * Custom style that uses app CSS variables for code block background and base text,
 * while keeping Prism token colors from oneDark.
 */
const codeBlockStyle = {
  ...oneDark,
  'code[class*="language-"]': {
    ...oneDark['code[class*="language-"]' as keyof typeof oneDark],
    background: 'var(--app-code-bg)',
    color: 'var(--app-code-text)',
    fontFamily: "'IBM Plex Mono', monospace",
  },
  'pre[class*="language-"]': {
    ...oneDark['pre[class*="language-"]' as keyof typeof oneDark],
    background: 'var(--app-code-bg)',
    color: 'var(--app-code-text)',
    fontFamily: "'IBM Plex Mono', monospace",
  },
};

function Pre({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) {
  const child = React.Children.only(children) as React.ReactElement | undefined;
  if (child?.props?.[SYNTAX_BLOCK_ATTR]) {
    return <>{children}</>;
  }
  return <pre {...props}>{children}</pre>;
}

function Code({
  node,
  inline,
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<'code'> & { node?: unknown }) {
  const match = /language-(\w+)/.exec(className || '');
  if (!inline && match) {
    const lang = match[1];
    const code = String(children).replace(/\n$/, '');
    return (
      <SyntaxHighlighter
        PreTag="div"
        PreTagProps={{ [SYNTAX_BLOCK_ATTR]: true }}
        language={lang}
        style={codeBlockStyle}
        customStyle={{
          margin: '1em 1.25em 2.25em 1.25em',
          padding: '10px 12px',
          borderRadius: '6px',
          fontSize: '0.95em',
        }}
        codeTagProps={{ style: { fontFamily: "'IBM Plex Mono', monospace" } }}
        showLineNumbers={false}
      >
        {code}
      </SyntaxHighlighter>
    );
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

/**
 * Components to pass to ReactMarkdown so fenced code blocks (e.g. ```js, ```python)
 * are rendered with syntax highlighting. Inline code is left as plain <code>.
 */
export const markdownCodeComponents: Components = {
  pre: Pre,
  code: Code,
};
