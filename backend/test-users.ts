import { UserService } from './src/services/user.service';

async function run() {
  try {
    const students = await UserService.getUsers('STUDENT');
    console.log('Students:', students);
  } catch (err: any) {
    console.error('Error:', err.message, err.stack);
  }
}

run();
