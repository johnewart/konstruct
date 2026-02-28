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

import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { trpc } from '../../client/trpc';

export function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  const {
    data: doc,
    isLoading,
    error,
  } = trpc.documents.getById.useQuery({ id: id! }, { enabled: !!id });

  if (!id) return <div>Missing document ID</div>;
  if (isLoading) return <div className="loading">Loading…</div>;
  if (error) return <div className="error">Error: {error.message}</div>;
  if (!doc) return <div>Document not found</div>;

  const created =
    typeof doc.createdAt === 'string'
      ? doc.createdAt
      : doc.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : String(doc.createdAt);

  return (
    <div className="container">
      <header className="header">
        <h1>{doc.title}</h1>
        <div className="metadata">
          <span className={`type-badge type-${doc.type}`}>{doc.type}</span>
          Created: {created}
        </div>
      </header>
      <div className="content markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
      </div>
      <Link to="/" className="back-link">
        ← Back to Chat
      </Link>
    </div>
  );
}
