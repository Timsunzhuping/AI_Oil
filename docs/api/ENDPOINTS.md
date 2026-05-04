# API Endpoints Documentation

## Base URL

```
Development: http://localhost:3001
Production: https://api.fluidmind.example.com
```

## Response Format

All API responses follow this format:

```json
{
  "code": 200,
  "message": "Success message",
  "data": {}
}
```

## Health Check

### GET /health

Returns the health status of the API.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

## Users Endpoints

### GET /users

Get list of all users (paginated).

**Query Parameters:**
- `page` (number): Page number (default: 1)
- `pageSize` (number): Items per page (default: 10)

**Response:**
```json
{
  "code": 200,
  "message": "Users retrieved",
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "email": "user@example.com",
      "name": "John Doe",
      "createdAt": "2024-01-01T12:00:00Z",
      "updatedAt": "2024-01-01T12:00:00Z"
    }
  ],
  "total": 100,
  "page": 1,
  "pageSize": 10
}
```

### GET /users/:id

Get a specific user by ID.

**Response:**
```json
{
  "code": 200,
  "message": "User retrieved",
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "name": "John Doe",
    "createdAt": "2024-01-01T12:00:00Z",
    "updatedAt": "2024-01-01T12:00:00Z"
  }
}
```

### POST /users

Create a new user.

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "name": "Jane Doe"
}
```

**Response:**
```json
{
  "code": 201,
  "message": "User created",
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174001",
    "email": "newuser@example.com",
    "name": "Jane Doe",
    "createdAt": "2024-01-02T12:00:00Z",
    "updatedAt": "2024-01-02T12:00:00Z"
  }
}
```

## Products Endpoints

### GET /products

Get list of all products (paginated).

**Query Parameters:**
- `page` (number): Page number (default: 1)
- `pageSize` (number): Items per page (default: 10)
- `status` (string): Filter by status (draft, testing, production)

**Response:**
```json
{
  "code": 200,
  "message": "Products retrieved",
  "data": [
    {
      "id": "456f7890-e89b-12d3-a456-426614174002",
      "name": "Formula A",
      "description": "Product formula A",
      "formula": {},
      "status": "draft",
      "createdAt": "2024-01-01T12:00:00Z",
      "updatedAt": "2024-01-01T12:00:00Z"
    }
  ],
  "total": 50,
  "page": 1,
  "pageSize": 10
}
```

### POST /products

Create a new product.

**Request Body:**
```json
{
  "name": "New Formula",
  "description": "Description of the formula",
  "formula": {}
}
```

**Response:**
```json
{
  "code": 201,
  "message": "Product created",
  "data": {
    "id": "456f7890-e89b-12d3-a456-426614174003",
    "name": "New Formula",
    "description": "Description of the formula",
    "formula": {},
    "status": "draft",
    "createdAt": "2024-01-02T12:00:00Z",
    "updatedAt": "2024-01-02T12:00:00Z"
  }
}
```

## Error Responses

**400 Bad Request:**
```json
{
  "code": 400,
  "message": "Invalid request parameters",
  "error": "Detailed error message"
}
```

**401 Unauthorized:**
```json
{
  "code": 401,
  "message": "Unauthorized",
  "error": "Authentication required"
}
```

**404 Not Found:**
```json
{
  "code": 404,
  "message": "Resource not found",
  "error": "The requested resource does not exist"
}
```

**500 Internal Server Error:**
```json
{
  "code": 500,
  "message": "Internal server error",
  "error": "An unexpected error occurred"
}
```

## Authentication (Future)

Authentication will be implemented using JWT tokens. The following headers will be required:

```
Authorization: Bearer <token>
```

## Rate Limiting (Future)

Rate limiting will be implemented with the following headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1609459200
```
