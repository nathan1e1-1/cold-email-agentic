import { NodeRepository } from '../../src/db/nodeRepository';
import { runRepositoryContract } from './contract';

runRepositoryContract(() => new NodeRepository(':memory:'));
