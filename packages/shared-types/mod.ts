export interface Doc {
  id: string;
  title: string;
  body: string;
  ownerOid: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface AclEntry {
  docId: string;
  oid: string;
  role: "owner" | "editor" | "viewer";
  grantedBy?: string;
  grantedAt: string;
}

export interface Attachment {
  id: string;
  docId: string;
  blobPath: string;
  contentType: string;
  sizeBytes: number;
  ownerOid: string;
  createdAt: string;
  expiresAt?: string;
}
