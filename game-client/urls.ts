export const gameURL = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
