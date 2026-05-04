# FluidMind Engineering Standards

Enterprise-grade engineering standards for the FluidMind platform.

## Code Organization

### Package Structure

Each package follows a consistent structure:

```
package-name/
├── src/              # Source code
├── dist/             # Compiled output
├── tests/            # Test files
├── package.json      # Package metadata
├── tsconfig.json     # TypeScript configuration
└── README.md         # Package documentation
```

### Naming Conventions

- **Files**: kebab-case for files (e.g., `health-controller.ts`)
- **Classes**: PascalCase (e.g., `HealthController`)
- **Functions**: camelCase (e.g., `getHealthStatus()`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`)
- **Types/Interfaces**: PascalCase (e.g., `HealthStatus`)

### Module Organization

```typescript
// 1. External imports
import express from 'express';
import { HealthStatus } from '@shared-types';

// 2. Internal imports
import { logger } from '@shared-utils';

// 3. Exports
export const healthHandler = () => {};
```

## TypeScript Standards

### Strict Mode

All TypeScript files must use strict mode:

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

### Type Guidelines

1. **Always define types for public APIs**:
```typescript
export interface UserResponse {
  id: string;
  email: string;
  name: string;
}

export function getUser(id: string): Promise<UserResponse> {
  // ...
}
```

2. **Use utility types appropriately**:
```typescript
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Partial<T> = { [P in keyof T]?: T[P] };
type Record<K, T> = { [P in K]: T };
```

3. **Avoid `any` type**:
```typescript
// ❌ Bad
const data: any = response.data;

// ✅ Good
const data: UserResponse = response.data;
```

## Code Quality

### Imports

1. **No barrel exports for large packages**:
```typescript
// ❌ Bad - encourages circular dependencies
export * from './models';
export * from './services';
export * from './controllers';

// ✅ Good - explicit imports
import { User } from './models/user';
import { UserService } from './services/user-service';
```

2. **One import per line for clarity**:
```typescript
// ❌ Bad
import { User, Post, Comment } from '@shared-types';

// ✅ Good (if multiple imports from same module)
import { User, Post, Comment } from '@shared-types';
// Or separate imports for clarity
import { User } from '@shared-types';
```

### Functions

1. **Keep functions small and focused**:
- Max 50 lines per function
- Single responsibility principle
- Clear parameter and return types

2. **Function parameter objects for multiple parameters**:
```typescript
// ❌ Avoid many parameters
function createUser(name: string, email: string, age: number, phone: string) {}

// ✅ Use object parameter
interface CreateUserParams {
  name: string;
  email: string;
  age: number;
  phone: string;
}

function createUser(params: CreateUserParams) {}
```

3. **Pure functions where possible**:
```typescript
// ✅ Good - pure function
const calculateTotal = (items: Item[]): number => {
  return items.reduce((sum, item) => sum + item.price, 0);
};

// ❌ Avoid - side effects
let total = 0;
const calculateTotal = (items: Item[]) => {
  items.forEach(item => total += item.price);
  return total;
};
```

## Error Handling

### Custom Error Classes

```typescript
export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Usage
throw new ApiError(400, 'Invalid request', { field: 'email' });
```

### Try-Catch Handling

```typescript
// ✅ Good error handling
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  logger.error('Operation failed', { error });
  throw new ApiError(500, 'Internal server error');
}
```

## Async Operations

### Promise Patterns

```typescript
// ✅ Good - explicit Promise typing
async function fetchUser(id: string): Promise<User> {
  return await userService.get(id);
}

// ✅ Good - using Promise type
function fetchUsers(): Promise<User[]> {
  return userService.getAll();
}
```

### Error Handling in Async

```typescript
// ✅ Try-catch in async functions
async function deleteUser(id: string): Promise<void> {
  try {
    await userService.delete(id);
  } catch (error) {
    logger.error('Failed to delete user', { error, userId: id });
    throw new ApiError(500, 'Failed to delete user');
  }
}
```

## React Best Practices (Frontend)

### Component Structure

```typescript
// ✅ Good component structure
interface Props {
  title: string;
  onSubmit: (data: FormData) => void;
}

export const MyComponent: React.FC<Props> = ({ title, onSubmit }) => {
  const [state, setState] = useState<State>(initialState);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(state);
  };

  return <form onSubmit={handleSubmit}>{title}</form>;
};
```

### Hooks Usage

```typescript
// ✅ Good - custom hook for reusable logic
function useUserData(userId: string) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      setLoading(true);
      try {
        const data = await api.getUser(userId);
        setUser(data);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [userId]);

  return { user, loading };
}
```

### Props Drilling Prevention

```typescript
// ✅ Use Context for shared state
const UserContext = createContext<UserContextType | null>(null);

export const UserProvider: React.FC<Props> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  return (
    <UserContext.Provider value={{ user, setUser }}>
      {children}
    </UserContext.Provider>
  );
};

const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within UserProvider');
  return context;
};
```

## Express.js Best Practices (Backend)

### Route Organization

```typescript
// ✅ Organize routes by feature
// routes/user.ts
const router = express.Router();

router.get('/:id', userController.getUser);
router.post('/', userController.createUser);
router.put('/:id', userController.updateUser);
router.delete('/:id', userController.deleteUser);

export default router;
```

### Middleware Pattern

```typescript
// ✅ Middleware for cross-cutting concerns
const authMiddleware: RequestHandler = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Verify token...
  next();
};

app.use('/api/protected', authMiddleware);
```

### Error Middleware

```typescript
// ✅ Centralized error handling
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', { error: err });

  if (err instanceof ApiError) {
    return res.status(err.code).json({ error: err.message });
  }

  res.status(500).json({ error: 'Internal server error' });
});
```

## Testing Standards

### Unit Tests

```typescript
// ✅ Clear test structure
describe('UserService', () => {
  describe('getUser', () => {
    it('should return user when found', async () => {
      const user = await userService.getUser('123');
      expect(user.id).toBe('123');
    });

    it('should throw when user not found', async () => {
      await expect(userService.getUser('invalid')).rejects.toThrow();
    });
  });
});
```

### Test Coverage

- Aim for **80%+ code coverage**
- Test happy paths, edge cases, and error scenarios
- Mock external dependencies

## Performance Considerations

### Frontend Performance

1. **Code Splitting**: Lazy load components
```typescript
const HeavyComponent = lazy(() => import('./HeavyComponent'));
```

2. **Memoization**: Prevent unnecessary re-renders
```typescript
export const OptimizedComponent = memo(MyComponent, (prev, next) => {
  return prev.id === next.id;
});
```

3. **Bundle Analysis**: Monitor bundle size
```bash
npm run build -- --analyze
```

### Backend Performance

1. **Database Indexing**: Add indexes for frequently queried fields
```sql
CREATE INDEX idx_users_email ON users(email);
```

2. **Connection Pooling**: Limit database connections
```typescript
const pool = new Pool({
  max: 20,
  min: 5,
  idleTimeoutMillis: 30000,
});
```

3. **Caching Strategy**:
```typescript
async function getUser(id: string): Promise<User> {
  const cached = await redis.get(`user:${id}`);
  if (cached) return JSON.parse(cached);

  const user = await db.users.findOne(id);
  await redis.set(`user:${id}`, JSON.stringify(user), 'EX', 3600);
  return user;
}
```

## Security Standards

### Input Validation

```typescript
// ✅ Always validate user input
import { z } from 'zod';

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
});

type CreateUserInput = z.infer<typeof createUserSchema>;
```

### SQL Injection Prevention

```typescript
// ✅ Use parameterized queries
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// ❌ Avoid string interpolation
const user = await db.query(`SELECT * FROM users WHERE id = ${userId}`);
```

### Secrets Management

```typescript
// ✅ Use environment variables for secrets
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error('JWT_SECRET not configured');

// ❌ Never hardcode secrets
const secret = 'my-secret-key';
```

## Documentation Standards

### Code Comments

Only document the **WHY**, not the **WHAT**:

```typescript
// ❌ Bad - explains what the code does
// Increment counter
counter++;

// ✅ Good - explains why
// Reset counter after successful batch processing
counter++;
```

### Function Documentation

```typescript
/**
 * Fetches a user by ID with caching.
 *
 * @param id - The user ID to fetch
 * @returns The user object or null if not found
 * @throws ApiError if database query fails
 */
export async function getUser(id: string): Promise<User | null> {
  // ...
}
```

### README Files

Each package should have:
- Brief description
- Installation instructions
- Usage examples
- API documentation
- Contributing guidelines

## Git Workflow

### Commit Messages

```
type(scope): description

More detailed explanation if needed.

Closes #123
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Example:
```
feat(user): add email verification

Implement email verification flow for user registration.
Users receive verification email after signup.

Closes #456
```

### Branch Naming

- Feature: `feature/add-user-authentication`
- Fix: `fix/email-validation-bug`
- Docs: `docs/api-documentation`
- Chore: `chore/update-dependencies`

## Continuous Integration

All code must:
1. ✅ Pass linter (`pnpm lint`)
2. ✅ Pass formatter check (`pnpm format:check`)
3. ✅ Pass type checking (`pnpm type-check`)
4. ✅ Pass tests (`pnpm test`)
5. ✅ Build successfully (`pnpm build`)

## Review Process

- **Code Review**: At least one approval required
- **CI Passing**: All checks must pass
- **Documentation**: Update if changing API or behavior
- **Tests**: Include tests for new features or bug fixes
- **Performance**: Benchmark impact on bundle size and runtime

## Monitoring and Logging

### Logging Levels

```typescript
logger.debug('Detailed debug info');    // Only in development
logger.info('User login successful');   // Normal operations
logger.warn('Cache miss for user:123'); // Potential issues
logger.error('Database connection failed'); // Errors
```

### Structured Logging

```typescript
logger.error('Operation failed', {
  operation: 'createUser',
  userId: id,
  error: err.message,
  timestamp: new Date().toISOString(),
});
```

---

**Last Updated**: 2024-01-01

For questions or updates to these standards, please open an issue or submit a PR.
