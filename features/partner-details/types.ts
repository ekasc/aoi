export type PartnerDetailCategory =
  | 'favorite'
  | 'habit'
  | 'quirk'
  | 'words'
  | 'other';

export type PartnerDetail = {
  id: string;
  text: string;
  category: PartnerDetailCategory;
  createdAt: string;
};

export type CreatePartnerDetailInput = {
  text: string;
  category?: PartnerDetailCategory;
};
