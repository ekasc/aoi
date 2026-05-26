export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};

export type PaginationParams = {
  cursor?: string;
  limit?: number;
};

export type DateRangeParams = {
  from: string;
  to: string;
};
