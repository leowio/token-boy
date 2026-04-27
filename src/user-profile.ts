export type UserProfile = {
  userId: string;
  username: string;
};

export function getOrCreateUserProfile(): UserProfile {
  const userIdKey = "token-boy-map-user-id";
  const usernameKey = "token-boy-map-user-name";

  let userId = localStorage.getItem(userIdKey);
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem(userIdKey, userId);
  }

  let username = localStorage.getItem(usernameKey);
  if (!username) {
    username = `DWELLER-${Math.floor(100 + Math.random() * 900)}`;
    localStorage.setItem(usernameKey, username);
  }

  return {
    userId,
    username,
  };
}
