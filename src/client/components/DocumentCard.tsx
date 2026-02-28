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
