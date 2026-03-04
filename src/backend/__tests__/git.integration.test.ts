import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getChangedFiles, isGitRepository, getGitRepoPath } from '../git';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Create a temporary git repository for integration tests
let testRepoPath: string;

beforeAll(() => {
  // Create a temporary directory for the test repo
  testRepoPath = path.join(__dirname, 'test-repo');
  
  // Clean up if it exists
  if (fs.existsSync(testRepoPath)) {
    fs.rmSync(testRepoPath, { recursive: true, force: true });
  }
  
  // Create directory
  fs.mkdirSync(testRepoPath, { recursive: true });
  
  // Initialize git repo
  execSync('git init', { cwd: testRepoPath });
  
  // Configure git user (required for commits)
  execSync('git config user.email "test@example.com"', { cwd: testRepoPath });
  execSync('git config user.name "Test User"', { cwd: testRepoPath });
  
  // Create a test file
  fs.writeFileSync(path.join(testRepoPath, 'test.txt'), 'test content');
  
  // Add file to git
  execSync('git add test.txt', { cwd: testRepoPath });
  
  // Commit file
  execSync('git commit -m "Initial commit"', { cwd: testRepoPath });
});

beforeEach(() => {
  // Ensure we start with a clean state for each test
  // This ensures tests don't interfere with each other
  try {
    // Restore the original test.txt file
    const testFilePath = path.join(testRepoPath, 'test.txt');
    if (fs.existsSync(testFilePath)) {
      fs.writeFileSync(testFilePath, 'test content');
    }
    
    // Reset git status
    execSync('git reset --hard', { cwd: testRepoPath });
    execSync('git clean -fd', { cwd: testRepoPath });
  } catch (error) {
    console.error('Error resetting test repo:', error);
  }
});

afterEach(() => {
  // Clean up any changes made by the test
  // This ensures each test starts with the same clean state
  try {
    // Remove any additional files created by tests
    const files = fs.readdirSync(testRepoPath);
    for (const file of files) {
      if (file !== 'test.txt' && file !== '.git') {
        const filePath = path.join(testRepoPath, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      }
    }
    
    // Reset git status
    execSync('git reset --hard', { cwd: testRepoPath });
    execSync('git clean -fd', { cwd: testRepoPath });
  } catch (error) {
    console.error('Error cleaning up test repo:', error);
  }
});

afterAll(() => {
  // Clean up test repo
  if (fs.existsSync(testRepoPath)) {
    fs.rmSync(testRepoPath, { recursive: true, force: true });
  }
});

describe('getChangedFiles integration tests', () => {
  it('should detect no changes when repo is clean', () => {
    const result = getChangedFiles(testRepoPath);
    expect(result).toEqual([]);
  });

  it('should detect modified file', () => {
    // Modify the test file
    fs.writeFileSync(path.join(testRepoPath, 'test.txt'), 'modified content');
    
    const result = getChangedFiles(testRepoPath);
    expect(result).toEqual([
      {
        path: 'test.txt',
        added: 0,
        removed: 0,
        status: 'M'
      }
    ]);
  });

  it('should detect added file', () => {
    // Create a new file
    fs.writeFileSync(path.join(testRepoPath, 'newfile.txt'), 'new content');
    
    const result = getChangedFiles(testRepoPath);
    expect(result).toEqual([
      {
        path: 'newfile.txt',
        added: 0,
        removed: 0,
        status: '??'
      }
    ]);
  });

  it('should detect staged added file', () => {
    // Create a new file
    fs.writeFileSync(path.join(testRepoPath, 'stagedfile.txt'), 'staged content');
    
    // Stage the file
    execSync('git add stagedfile.txt', { cwd: testRepoPath });
    
    const result = getChangedFiles(testRepoPath);
    expect(result).toEqual([
      {
        path: 'stagedfile.txt',
        added: 0,
        removed: 0,
        status: 'A'
      }
    ]);
  });

  it('should detect deleted file', () => {
    // Delete the test file
    fs.unlinkSync(path.join(testRepoPath, 'test.txt'));
    
    const result = getChangedFiles(testRepoPath);
    expect(result).toEqual([
      {
        path: 'test.txt',
        added: 0,
        removed: 0,
        status: 'D'
      }
    ]);
  });

  it('should detect staged deleted file', () => {
    // Delete the test file
    fs.unlinkSync(path.join(testRepoPath, 'test.txt'));
    
    // Stage the deletion
    execSync('git add test.txt', { cwd: testRepoPath });
    
    const result = getChangedFiles(testRepoPath);
    expect(result).toEqual([
      {
        path: 'test.txt',
        added: 0,
        removed: 0,
        status: 'D'
      }
    ]);
  });

  it('should detect renamed file', () => {
    // Use git mv for true rename (stages the rename automatically)
    execSync('git mv test.txt renamed.txt', { cwd: testRepoPath });
    
    const result = getChangedFiles(testRepoPath);
    expect(result).toEqual([
      {
        path: 'renamed.txt',
        added: 0,
        removed: 0,
        status: 'R'
      }
    ]);
  });

  it('should detect copied file', () => {
    // Create a copy
    fs.copyFileSync(path.join(testRepoPath, 'test.txt'), path.join(testRepoPath, 'copied.txt'));
    
    // Stage the copy
    execSync('git add copied.txt', { cwd: testRepoPath });
    
    const result = getChangedFiles(testRepoPath);
    expect(result).toEqual([
      {
        path: 'copied.txt',
        added: 0,
        removed: 0,
        status: 'A'  // Git shows copies as 'A' (added), not 'C' in porcelain format
      }
    ]);
  });

  it('should detect multiple changes at once', () => {
    // Create multiple changes
    fs.writeFileSync(path.join(testRepoPath, 'modified.txt'), 'modified content');
    fs.writeFileSync(path.join(testRepoPath, 'newfile.txt'), 'new content');
    
    // Stage both files
    execSync('git add modified.txt', { cwd: testRepoPath });
    execSync('git add newfile.txt', { cwd: testRepoPath });
    
    const result = getChangedFiles(testRepoPath);
    const paths = result.map(r => r.path);
    
    expect(paths).toContain('modified.txt');
    expect(paths).toContain('newfile.txt');
    
    const modified = result.find(r => r.path === 'modified.txt');
    const newfile = result.find(r => r.path === 'newfile.txt');
    
    expect(modified?.status).toBe('A');
    expect(newfile?.status).toBe('A');
  });

  it('should return false for non-git repository', () => {
    const result = isGitRepository('/nonexistent/path');
    expect(result).toBe(false);
  });

  it('should return true for git repository', () => {
    const result = isGitRepository(testRepoPath);
    expect(result).toBe(true);
  });
});