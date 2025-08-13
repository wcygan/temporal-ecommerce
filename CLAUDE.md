# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Temporal-based e-commerce demo application built in Go with a Vue.js frontend. It demonstrates shopping cart management using Temporal workflows, with integrations to Stripe for payments and Mailgun for email notifications.

**Note**: This project uses traditional Go + JavaScript stack rather than the modern Deno/Fresh stack. For this project, use npm/node rather than Deno for frontend development.

## Development Commands

### Environment Setup
Required environment variables:
```bash
export STRIPE_PRIVATE_KEY=your_stripe_key_here
export MAILGUN_DOMAIN=your_mailgun_domain_here  
export MAILGUN_PRIVATE_KEY=your_mailgun_key_here
export PORT=3001
```

### Core Development Commands

**Start all services** (run in separate terminals):
1. Start Temporal Server (external dependency)
2. Start Worker: `go run worker/main.go`
3. Start API Server: `go run api/main.go` 
4. Start Frontend: `cd frontend && npm install && npm start`

**Testing**:
- Go tests: `go test` (includes comprehensive Temporal workflow tests)
- Frontend tests: `cd frontend && npm test`
- Single test: `go test -run TestCartWorkflow_AddRemoveItem`

**Build**:
- Frontend: `cd frontend && npm run build`
- Go: No build step needed (uses `go run`)

## Architecture Overview

### Temporal Workflow Architecture
- **CartWorkflow**: Long-running stateful workflow managing shopping cart lifecycle
- **Activities**: External service integrations (Stripe payments, Mailgun emails)
- **Signals**: Event-driven cart operations (add/remove items, checkout, email updates)
- **Queries**: Real-time cart state inspection without side effects

### Service Components
- `/api/` - REST API server (port 3001) using Gorilla Mux
- `/worker/` - Temporal worker process executing workflows and activities
- `/frontend/` - Vue.js 3 SPA (port 8080) with Express dev server
- Root level - Core workflow logic (`workflow.go`, `activities.go`, `shared.go`)

### Key Workflow Patterns

**Signal Channels** (in `shared.go`):
- `ADD_TO_CART_CHANNEL` - Add items to cart
- `REMOVE_FROM_CART_CHANNEL` - Remove items from cart
- `UPDATE_EMAIL_CHANNEL` - Update customer email
- `CHECKOUT_CHANNEL` - Initiate checkout and terminate workflow

**State Management**:
- Cart state persisted automatically by Temporal
- Event-driven mutations through signals
- Abandoned cart detection using conditional timers (10-second timeout in dev)

## Testing Patterns

### Temporal Workflow Testing
Use `testsuite.WorkflowTestSuite` for workflow tests:

```go
// Mock activities for testing
s.env.OnActivity(a.CreateStripeCharge, mock.Anything, mock.Anything).Return(nil)

// Use delayed callbacks for signal testing
s.env.RegisterDelayedCallback(func() {
    s.env.SignalWorkflow("ADD_TO_CART_CHANNEL", addRequest)
}, time.Millisecond*1)
```

**Key Testing Principles**:
- Mock external activities (Stripe, Mailgun) to avoid real API calls
- Use logical time control for timer-based features
- Test signal/query interactions with delayed callbacks
- Test workflow completion scenarios (checkout, abandoned cart)

### Test Organization
- `workflow_test.go` - Comprehensive workflow test suite
- `frontend/test/` - Frontend component tests with Mocha
- Use `go test -v` for detailed test output

## Development Workflow

1. **Feature Development**: Work directly on main branch or create feature branches
2. **Testing Strategy**: Write workflow tests first, then implement business logic
3. **External Services**: Use environment variables for API keys, mock in tests
4. **State Management**: All business state lives in Temporal workflows, not databases
5. **Frontend-Backend Communication**: API calls trigger Temporal signals/queries

## Common Development Tasks

### Adding New Cart Operations
1. Define new signal channel in `shared.go`
2. Add signal handler in workflow selector loop (`workflow.go`)
3. Implement state mutation logic
4. Add corresponding API endpoint (`api/main.go`)
5. Write workflow tests with signal verification

### Testing Abandoned Cart Logic
Use time manipulation in tests:
```go
// Fast-forward time to trigger abandoned cart timer
s.env.Sleep(time.Second * 11)
```

### Activity Development
- Implement activities in `activities.go` for external service calls
- Register activities in worker with dependency injection pattern
- Mock activities in tests to avoid external dependencies

## Project-Specific Considerations

- This project demonstrates educational patterns, not production-ready code
- Uses shortened timeouts (10 seconds) for demo purposes
- Follows Temporal best practices for deterministic workflows
- External service failures are handled gracefully through Temporal retries
- Cart state is queryable in real-time without affecting workflow execution