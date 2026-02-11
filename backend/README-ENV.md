# Environment Configuration

## Overview

The backend supports **two ways** to specify the environment for store provisioning:

1. **UI Selection (Recommended for Assessment)**: User selects environment in the dashboard
2. **Backend Default (.env file)**: Set a default environment for the backend deployment

## Approach: Hybrid (Best Practice)

### Why Both?

- **UI Selection**: Allows flexibility - users can provision stores to different environments from the same dashboard
- **Backend Default**: Ensures consistency when UI doesn't specify, or for API-only usage

### Priority Order

1. **Request parameter** (`environment` from UI/API) - Highest priority
2. **Backend default** (`DEFAULT_ENVIRONMENT` from `.env`) - Fallback
3. **Hardcoded default** (`'local'`) - Last resort

## Setup

### Option 1: UI Selection Only (Current Default)

No `.env` file needed. The UI selection will always be used.

### Option 2: Backend Default via .env

1. Create `.env` file in `backend/` directory:
   ```bash
   cd backend
   cp .env.example .env
   ```

2. Edit `.env`:
   ```env
   # Set default environment for all stores
   DEFAULT_ENVIRONMENT=local
   
   # Or for production backend:
   # DEFAULT_ENVIRONMENT=prod
   ```

3. Restart backend to pick up changes

## Use Cases

### Assessment/Demo (Recommended)
- **Use UI selection** - Shows flexibility and good UX
- No `.env` needed - Simpler setup

### Production Deployment
- **Backend `.env`** with `DEFAULT_ENVIRONMENT=prod` - Ensures all stores go to production
- **UI selection** can still override if needed

### Development
- **Backend `.env`** with `DEFAULT_ENVIRONMENT=local` - Default to local
- **UI selection** allows testing prod configs

## Example

```bash
# Backend .env
DEFAULT_ENVIRONMENT=local

# User selects "Production" in UI
# Result: Uses values-prod.yaml (UI selection wins)

# User doesn't select environment in UI
# Result: Uses values-local.yaml (backend default)
```

## For Assessment

**Recommendation**: Use UI selection approach (current implementation)
- Demonstrates flexible API design
- Better user experience
- Shows understanding of multi-tenant architecture
- `.env` file is optional for production deployments

