# Development Notes

## Server Management

### API Server
- **Port**: 3000
- **Start**: `cd application/api-server && npm run dev`
- **Stop**: Kill process on port 3000 or use Ctrl+C

### Vue Frontend
- **Port**: 5173
- **Start**: `cd application/vue-frontend && npm run dev`
- **Stop**: Kill process on port 5173 or use Ctrl+C

## Important Notes

1. **Never start servers in background** - Always let the user start/stop servers themselves
2. **If testing requires server**, prompt user to start it
3. **Clean up any processes** started during development
4. **Document server commands** for user reference

## Quick Commands

### Kill process on port 3000
```bash
# Find PID
netstat -ano | findstr :3000

# Kill process
taskkill /PID <PID> /F
```

### Kill process on port 5173
```bash
# Find PID
netstat -ano | findstr :5173

# Kill process
taskkill /PID <PID> /F
```

