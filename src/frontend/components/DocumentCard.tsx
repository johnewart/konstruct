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

import { Link } from 'react-router-dom';

type Document = {
  id: string;
  title: string;
  type: string;
  createdAt: Date | string;
};

export function DocumentCard({ doc }: { doc: Document }) {
  const created =
    typeof doc.createdAt === 'string'
      ? doc.createdAt
      : doc.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : String(doc.createdAt);

  return (
    <div className="doc-card">
      <h3>{doc.title}</h3>
      <div>
        <span className={`type-badge type-${doc.type}`}>{doc.type}</span>
        <span className="meta">{created}</span>
      </div>
      <Link to={`/doc/${doc.id}`}>View Document →</Link>
    </div>
  );
}
