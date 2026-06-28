export function createUserCache(storage) {
  if (!storage || typeof storage.loadUser !== "function" || typeof storage.saveUser !== "function") {
    throw new TypeError("storage must provide loadUser and saveUser");
  }

  const cachedUsers = new Map();

  return {
    getUser(id) {
      if (cachedUsers.has(id)) {
        return cachedUsers.get(id);
      }
      const loaded = storage.loadUser(id);
      if (loaded) {
        cachedUsers.set(id, loaded);
      }
      return loaded;
    },
    updateUser(id, user) {
      const saved = storage.saveUser(id, user);
      cachedUsers.set(id, saved);
      return saved;
    },
    clear() {
      cachedUsers.clear();
    }
  };
}
