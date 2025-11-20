# Custom React Hooks

This directory contains custom React hooks for Firebase integration.

## Available Hooks

### `useAuth` - Authentication Hook

Manages Firebase Authentication state and provides auth methods.

**Example Usage:**

```javascript
import { useAuth } from '@/app/hooks/useAuth';

function LoginPage() {
  const { user, loading, error, signIn, signOut, isAuthenticated } = useAuth();

  const handleLogin = async (e) => {
    e.preventDefault();
    const { user, error } = await signIn(email, password);
    if (error) {
      console.error('Login failed:', error);
    } else {
      console.log('Logged in:', user);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (isAuthenticated) return <div>Welcome, {user.displayName}!</div>;

  return (
    <form onSubmit={handleLogin}>
      {/* Your login form */}
    </form>
  );
}
```

**Available Properties:**
- `user` - Current authenticated user (null if not authenticated)
- `loading` - Boolean indicating if auth state is loading
- `error` - Error message if any
- `isAuthenticated` - Boolean indicating if user is logged in

**Available Methods:**
- `signIn(email, password)` - Sign in with email/password
- `signUp(email, password, displayName)` - Create new user account
- `signOut()` - Sign out current user

---

### `useFirestore` - Firestore Database Hook

Provides CRUD operations for Firestore collections.

**Example Usage:**

```javascript
import { useFirestore } from '@/app/hooks/useFirestore';
import { where, orderBy } from 'firebase/firestore';

function UsersPage() {
  const { 
    loading, 
    error, 
    getAllDocuments, 
    addDocument, 
    updateDocument,
    deleteDocument,
    queryDocuments
  } = useFirestore('users');

  // Get all users
  const loadUsers = async () => {
    const { data, error } = await getAllDocuments();
    if (data) {
      console.log('Users:', data);
    }
  };

  // Add new user
  const addUser = async (userData) => {
    const { id, error } = await addDocument(userData);
    if (id) {
      console.log('User added with ID:', id);
    }
  };

  // Update user
  const updateUser = async (userId, updates) => {
    const { error } = await updateDocument(userId, updates);
    if (!error) {
      console.log('User updated');
    }
  };

  // Query users with filters
  const loadAdultUsers = async () => {
    const { data } = await queryDocuments([
      where('age', '>=', 18),
      orderBy('name')
    ]);
    console.log('Adult users:', data);
  };

  return <div>{/* Your component JSX */}</div>;
}
```

**Available Properties:**
- `loading` - Boolean indicating if operation is in progress
- `error` - Error message if any

**Available Methods:**
- `getDocument(docId)` - Get single document by ID
- `getAllDocuments()` - Get all documents in collection
- `queryDocuments(queryConstraints)` - Query with filters
- `addDocument(data)` - Add new document with auto ID
- `setDocument(docId, data)` - Set document with specific ID
- `updateDocument(docId, data)` - Update existing document
- `deleteDocument(docId)` - Delete document

---

## Best Practices

1. **Always handle errors** - Check the `error` property in responses
2. **Show loading states** - Use the `loading` property for better UX
3. **Cleanup on unmount** - Hooks automatically handle cleanup
4. **Security rules** - Configure proper Firestore security rules in production

## Additional Resources

- [Firebase Authentication Docs](https://firebase.google.com/docs/auth)
- [Firestore Docs](https://firebase.google.com/docs/firestore)
- [React Hooks Best Practices](https://react.dev/reference/react)

