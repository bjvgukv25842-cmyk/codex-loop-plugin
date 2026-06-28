export function createMemoryUserStorage(initialUsers = {}) {
  const users = new Map(Object.entries(initialUsers));
  const calls = {
    loadUser: [],
    saveUser: []
  };

  return {
    calls,
    loadUser(id) {
      calls.loadUser.push(id);
      return users.has(id) ? { ...users.get(id) } : null;
    },
    saveUser(id, user) {
      calls.saveUser.push({ id, user: { ...user } });
      users.set(id, { ...user });
      return { ...users.get(id) };
    }
  };
}
