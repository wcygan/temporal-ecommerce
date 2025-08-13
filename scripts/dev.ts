#!/usr/bin/env deno run --allow-run --allow-read --allow-env --allow-write

import { exists } from "@std/fs";

// Load environment variables from .env file
async function loadEnv(): Promise<void> {
  const envPath = ".env";
  
  if (await exists(envPath)) {
    const envContent = await Deno.readTextFile(envPath);
    
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=');
          Deno.env.set(key, value);
        }
      }
    }
    
    console.log("✅ Loaded environment variables from .env");
  } else {
    console.log("⚠️  No .env file found, using system environment variables");
  }
}

// Check if required environment variables are set
function checkEnvironment(): boolean {
  const required = [
    "STRIPE_PRIVATE_KEY",
    "RESEND_API_KEY", 
    "RESEND_FROM_EMAIL",
    "TEST_EMAIL"
  ];
  
  let allSet = true;
  for (const env of required) {
    if (!Deno.env.get(env)) {
      console.error(`❌ Missing required environment variable: ${env}`);
      allSet = false;
    }
  }
  
  if (!allSet) {
    console.error("\n💡 Please set the required environment variables in .env file");
    console.error("   See .env.example for reference");
    return false;
  }
  
  return true;
}

// Get environment variables as an object
function getEnvObject(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of Object.keys(Deno.env.toObject())) {
    const value = Deno.env.get(key);
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

// Start a service in the background
async function startService(name: string, command: string[], cwd?: string): Promise<Deno.ChildProcess> {
  console.log(`🚀 Starting ${name}...`);
  
  const process = new Deno.Command(command[0], {
    args: command.slice(1),
    cwd: cwd,
    env: getEnvObject(),
    stdout: "piped",
    stderr: "piped"
  }).spawn();
  
  // Pipe output with service name prefix
  (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of process.stdout) {
        const text = decoder.decode(chunk);
        for (const line of text.split('\n')) {
          if (line.trim()) {
            console.log(`[${name}] ${line}`);
          }
        }
      }
    } catch (error) {
      // Stream closed, ignore
      if (!(error instanceof TypeError && error.message.includes("readable"))) {
        console.error(`[${name}] stdout error:`, error);
      }
    }
  })();
  
  (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of process.stderr) {
        const text = decoder.decode(chunk);
        for (const line of text.split('\n')) {
          if (line.trim()) {
            console.error(`[${name}] ${line}`);
          }
        }
      }
    } catch (error) {
      // Stream closed, ignore  
      if (!(error instanceof TypeError && error.message.includes("readable"))) {
        console.error(`[${name}] stderr error:`, error);
      }
    }
  })();
  
  return process;
}

// Check if a command exists
async function commandExists(command: string): Promise<boolean> {
  try {
    const process = new Deno.Command("which", {
      args: [command],
      stdout: "null",
      stderr: "null"
    });
    const { success } = await process.output();
    return success;
  } catch {
    return false;
  }
}

// Kill processes using specified ports
async function killPortProcesses(ports: number[]): Promise<void> {
  console.log("🧹 Cleaning up processes on required ports...");
  
  for (const port of ports) {
    try {
      // Find processes using the port
      const lsofCommand = new Deno.Command("lsof", {
        args: ["-ti", `:${port}`],
        stdout: "piped",
        stderr: "null"
      });
      
      const { success, stdout } = await lsofCommand.output();
      
      if (success && stdout.length > 0) {
        const pids = new TextDecoder().decode(stdout).trim().split('\n').filter(pid => pid);
        
        for (const pid of pids) {
          console.log(`  🔪 Killing process ${pid} on port ${port}`);
          try {
            const killCommand = new Deno.Command("kill", {
              args: ["-9", pid],
              stdout: "null",
              stderr: "null"
            });
            await killCommand.output();
          } catch {
            // Ignore kill errors (process might already be dead)
          }
        }
      }
    } catch {
      // lsof might not be available or port might be free - ignore
    }
  }
  
  // Wait a bit for ports to be freed
  await new Promise(resolve => setTimeout(resolve, 1000));
}

// Wait for frontend dependencies to be installed
async function ensureFrontendDeps(): Promise<void> {
  const nodeModulesExists = await exists("frontend/node_modules");
  if (!nodeModulesExists) {
    console.log("📦 Installing frontend dependencies...");
    const npmInstall = new Deno.Command("npm", {
      args: ["install"],
      cwd: "frontend",
      stdout: "piped",
      stderr: "piped"
    });
    
    const { success } = await npmInstall.output();
    if (!success) {
      throw new Error("Failed to install frontend dependencies");
    }
    console.log("✅ Frontend dependencies installed");
  }
}

async function main(): Promise<void> {
  console.log("🏗️  Starting Temporal E-commerce Development Environment\n");
  
  // Clean up any processes using our ports
  await killPortProcesses([7233, 8233, 3001, 8080]);
  
  // Load environment variables
  await loadEnv();
  
  // Check environment
  if (!checkEnvironment()) {
    Deno.exit(1);
  }
  
  // Check if temporal CLI is available
  if (!(await commandExists("temporal"))) {
    console.error("❌ Temporal CLI not found. Please install it:");
    console.error("   https://docs.temporal.io/cli#install");
    Deno.exit(1);
  }
  
  // Check if Go is available
  if (!(await commandExists("go"))) {
    console.error("❌ Go not found. Please install Go:");
    console.error("   https://golang.org/dl/");
    Deno.exit(1);
  }
  
  // Check if npm is available
  if (!(await commandExists("npm"))) {
    console.error("❌ npm not found. Please install Node.js:");
    console.error("   https://nodejs.org/");
    Deno.exit(1);
  }
  
  const services: Deno.ChildProcess[] = [];
  let isShuttingDown = false;
  
  // Cleanup function
  const cleanup = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log("\n🛑 Stopping all services...");
    
    // Kill all services in reverse order
    for (let i = services.length - 1; i >= 0; i--) {
      const service = services[i];
      try {
        console.log(`  Stopping service ${i + 1}...`);
        service.kill("SIGTERM");
        
        // Wait a bit for graceful shutdown
        const timeout = setTimeout(() => {
          console.log(`  Force killing service ${i + 1}...`);
          service.kill("SIGKILL");
        }, 3000);
        
        await service.status;
        clearTimeout(timeout);
        console.log(`  ✅ Service ${i + 1} stopped`);
      } catch (error) {
        console.log(`  ⚠️  Service ${i + 1} cleanup error:`, error.message);
      }
    }
    
    console.log("🏁 All services stopped");
  };
  
  // Setup signal handlers early
  const sigintHandler = () => {
    cleanup().then(() => Deno.exit(0));
  };
  
  Deno.addSignalListener("SIGINT", sigintHandler);
  Deno.addSignalListener("SIGTERM", sigintHandler);
  
  try {
    // Start Temporal Server
    const temporal = await startService("Temporal", ["temporal", "server", "start-dev"]);
    services.push(temporal);
    
    // Wait a bit for Temporal to start
    console.log("⏳ Waiting for Temporal server to start...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Start Worker  
    const worker = await startService("Worker", ["go", "run", "worker/main.go"]);
    services.push(worker);
    
    // Wait a bit for worker to connect
    console.log("⏳ Waiting for worker to connect...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Start API Server
    const api = await startService("API", ["go", "run", "api/main.go"]);
    services.push(api);
    
    // Wait a bit for API to start
    console.log("⏳ Waiting for API server to start...");
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Ensure frontend dependencies and start frontend
    await ensureFrontendDeps();
    const frontend = await startService("Frontend", ["npm", "start"], "frontend");
    services.push(frontend);
    
    // Wait for frontend to compile
    console.log("⏳ Waiting for frontend to compile...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log("\n🎉 All services started successfully!");
    console.log("\n📋 Service URLs:");
    console.log("   🌐 Frontend:    http://localhost:8080");
    console.log("   🔌 API:         http://localhost:3001"); 
    console.log("   ⚡ Temporal UI: http://localhost:8233");
    console.log("\n💡 Press Ctrl+C to stop all services");
    
    // Keep the script running until interrupted
    console.log("🔄 Monitoring services... Press Ctrl+C to stop");
    
    // Create a promise that never resolves (keeps script running)
    const keepAlive = new Promise<void>(() => {});
    
    // Monitor services for unexpected exits in the background
    const serviceNames = ["Temporal", "Worker", "API", "Frontend"];
    services.forEach((service, index) => {
      service.status.then((status) => {
        if (!isShuttingDown) {
          console.error(`❌ ${serviceNames[index]} service exited unexpectedly with code ${status.code}`);
          console.error(`   This usually indicates a configuration or dependency issue.`);
          cleanup().then(() => Deno.exit(1));
        }
      }).catch((error) => {
        if (!isShuttingDown) {
          console.error(`❌ ${serviceNames[index]} service monitoring error:`, error.message);
          cleanup().then(() => Deno.exit(1));
        }
      });
    });
    
    // Wait for user interruption (keepAlive never resolves)
    await keepAlive;
    
  } catch (error) {
    console.error(`❌ Error starting services: ${error.message}`);
    await cleanup();
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}