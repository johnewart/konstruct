import { createLogger } from '../logger';

const log = createLogger('documentStore');

export type DocumentType = 'plan' | 'design' | 'generic';

export interface Document {
  id: string;
  title: string;
  content: string;
  type: DocumentType;
  createdAt: Date;
  updatedAt: Date;
}

const documents = new Map<string, Document>();

export function addDocument(
  doc: Omit<Document, 'id' | 'createdAt' | 'updatedAt'>
): Document {
  const id = crypto.randomUUID();
  const now = new Date();
  const document: Document = {
    id,
    title: doc.title,
    content: doc.content,
    type: doc.type ?? 'generic',
    createdAt: now,
    updatedAt: now,
  };
  documents.set(id, document);
  log.info('addDocument', id, doc.title, doc.type);
  return document;
}

export function getDocument(id: string): Document | undefined {
  return documents.get(id);
}

export function listDocuments(): Document[] {
  return Array.from(documents.values());
}
