import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/index.js', () => ({
  config: { PORT: 3000, OPENROUTER_DEFAULT_MODEL: 'openai/gpt-4o-mini', CONVERSATION_WINDOW_SIZE: 20 },
  getToolSubstitutionVars: () => ({ PORT: '3000' }),
}));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}));

vi.mock('../../src/db/client.js', () => ({
  prisma: {
    menuItem: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/db/client.js';
import {
  getRootMenuItems,
  getChildren,
  getMenuItemById,
  seedDefaultMenus,
} from '../../src/services/menu.js';

const mockItem = (overrides = {}) => ({
  id: 1,
  label: 'Test',
  parentId: null,
  sortOrder: 0,
  isActive: true,
  actionType: 'submenu',
  actionValue: '',
  resultSubmenuId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('menu service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getRootMenuItems', () => {
    it('queries active root items ordered by sortOrder', async () => {
      const items = [mockItem({ id: 1 }), mockItem({ id: 2, sortOrder: 1 })];
      vi.mocked(prisma.menuItem.findMany).mockResolvedValue(items);

      const result = await getRootMenuItems();

      expect(prisma.menuItem.findMany).toHaveBeenCalledWith({
        where: { parentId: null, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('getChildren', () => {
    it('queries active children of the given parentId', async () => {
      const children = [mockItem({ id: 3, parentId: 1 }), mockItem({ id: 4, parentId: 1, sortOrder: 1 })];
      vi.mocked(prisma.menuItem.findMany).mockResolvedValue(children);

      const result = await getChildren(1);

      expect(prisma.menuItem.findMany).toHaveBeenCalledWith({
        where: { parentId: 1, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('getMenuItemById', () => {
    it('returns the item when found', async () => {
      const item = mockItem({ id: 5 });
      vi.mocked(prisma.menuItem.findUnique).mockResolvedValue(item);

      const result = await getMenuItemById(5);

      expect(prisma.menuItem.findUnique).toHaveBeenCalledWith({ where: { id: 5 } });
      expect(result).toEqual(item);
    });

    it('returns null when not found', async () => {
      vi.mocked(prisma.menuItem.findUnique).mockResolvedValue(null);
      const result = await getMenuItemById(999);
      expect(result).toBeNull();
    });
  });

  describe('seedDefaultMenus', () => {
    it('skips seeding when menus already exist', async () => {
      vi.mocked(prisma.menuItem.count).mockResolvedValue(7);

      await seedDefaultMenus();

      expect(prisma.menuItem.create).not.toHaveBeenCalled();
      expect(prisma.menuItem.createMany).not.toHaveBeenCalled();
    });

    it('creates the default menu tree when no menus exist', async () => {
      vi.mocked(prisma.menuItem.count).mockResolvedValue(0);
      vi.mocked(prisma.menuItem.create)
        .mockResolvedValueOnce(mockItem({ id: 10, label: '조회 유형 선택' }))
        .mockResolvedValueOnce(mockItem({ id: 11, label: '🌍 지역 날씨/시간 조회' }));
      vi.mocked(prisma.menuItem.createMany).mockResolvedValue({ count: 2 });

      await seedDefaultMenus();

      expect(prisma.menuItem.create).toHaveBeenCalledTimes(2);
      expect(prisma.menuItem.createMany).toHaveBeenCalledTimes(2);

      const firstCreateCall = vi.mocked(prisma.menuItem.create).mock.calls[0][0];
      expect(firstCreateCall.data.label).toBe('조회 유형 선택');
      expect(firstCreateCall.data.actionType).toBe('submenu');
    });
  });
});
