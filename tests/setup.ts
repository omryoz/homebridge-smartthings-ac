import nock from 'nock';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env file
const envPath = path.join(process.cwd(), '.env');
dotenv.config({ path: envPath });

// Global test setup
beforeAll(() => {
  // Disable real HTTP requests during tests
  nock.disableNetConnect();
  
  // Allow localhost for potential local testing
  nock.enableNetConnect('127.0.0.1');
  nock.enableNetConnect('localhost');
});

afterAll(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
});

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}; 