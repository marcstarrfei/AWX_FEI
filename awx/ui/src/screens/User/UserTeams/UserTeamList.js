import React, { useState, useCallback, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { t } from '@lingui/macro';

import PaginatedTable, {
  HeaderRow,
  HeaderCell,
  ToolbarAddButton,
  getSearchableKeys,
} from 'components/PaginatedTable';
import DataListToolbar from 'components/DataListToolbar';
import DisassociateButton from 'components/DisassociateButton';
import AssociateModal from 'components/AssociateModal';
import AlertModal from 'components/AlertModal';
import ErrorDetail from 'components/ErrorDetail';
import useRequest, {
  useDeleteItems,
  useDismissableError,
} from 'hooks/useRequest';
import useSelected from 'hooks/useSelected';
import { TeamsAPI, UsersAPI } from 'api';
import { getQSConfig, mergeParams, parseQueryString } from 'util/qs';

import UserTeamListItem from './UserTeamListItem';

const QS_CONFIG = getQSConfig('teams', {
  page: 1,
  page_size: 20,
  order_by: 'name',
});

function UserTeamList() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const location = useLocation();
  const { id: userId } = useParams();

  const {
    result: {
      teams,
      count,
      userOptions,
      relatedSearchableKeys,
      searchableKeys,
    },
    error: contentError,
    isLoading,
    request: fetchTeams,
  } = useRequest(
    useCallback(async () => {
      const params = parseQueryString(QS_CONFIG, location.search);
      const [
        {
          data: { results, count: teamCount },
        },
        actionsResponse,
        usersResponse,
      ] = await Promise.all([
        UsersAPI.readTeams(userId, params),
        UsersAPI.readTeamsOptions(userId),
        UsersAPI.readOptions(),
      ]);
      return {
        teams: results,
        count: teamCount,
        userOptions: usersResponse.data.actions,
        actions: actionsResponse.data.actions,
        relatedSearchableKeys: (
          actionsResponse?.data?.related_search_fields || []
        ).map((val) => val.slice(0, -8)),
        searchableKeys: getSearchableKeys(actionsResponse.data.actions?.GET),
      };
    }, [userId, location.search]),
    {
      teams: [],
      count: 0,
      roles: {},
      userOptions: {},
      relatedSearchableKeys: [],
      searchableKeys: [],
    }
  );

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const { selected, isAllSelected, handleSelect, clearSelected, selectAll } =
    useSelected(teams);

  const disassociateUserRoles = (team) => [
    UsersAPI.disassociateRole(
      userId,
      team.summary_fields.object_roles.admin_role.id
    ),
    UsersAPI.disassociateRole(
      userId,
      team.summary_fields.object_roles.member_role.id
    ),
    UsersAPI.disassociateRole(
      userId,
      team.summary_fields.object_roles.read_role.id
    ),
  ];

  const {
    isLoading: isDisassociateLoading,
    deleteItems: disassociateTeams,
    deletionError: disassociateError,
  } = useDeleteItems(
    useCallback(
      () =>
        Promise.all(selected.flatMap((team) => disassociateUserRoles(team))),
      /* eslint-disable-next-line react-hooks/exhaustive-deps */
      [selected]
    ),
    {
      qsConfig: QS_CONFIG,
      allItemsSelected: isAllSelected,
      fetchItems: fetchTeams,
    }
  );

  const { request: handleAssociate, error: associateError } = useRequest(
    useCallback(
      async (teamsToAssociate) => {
        await Promise.all(
          teamsToAssociate.map((team) =>
            UsersAPI.associateRole(
              userId,
              team.summary_fields.object_roles.member_role.id
            )
          )
        );
        fetchTeams();
      },
      [userId, fetchTeams]
    )
  );

  const handleDisassociate = async () => {
    await disassociateTeams();
    clearSelected();
  };

  const { error, dismissError } = useDismissableError(
    associateError || disassociateError
  );

  const canAdd =
    userOptions && Object.prototype.hasOwnProperty.call(userOptions, 'POST');

  const fetchTeamsToAssociate = useCallback(
    (params) =>
      TeamsAPI.read(
        mergeParams(params, {
          not__member_role__members__id: userId,
          not__admin_role__members__id: userId,
        })
      ),
    [userId]
  );

  const readTeamOptions = useCallback(
    () => UsersAPI.readTeamsOptions(userId),
    [userId]
  );

  return (
    <>
      <PaginatedTable
        items={teams}
        contentError={contentError}
        hasContentLoading={isLoading || isDisassociateLoading}
        itemCount={count}
        pluralizedItemName={t`Teams`}
        qsConfig={QS_CONFIG}
        clearSelected={clearSelected}
        headerRow={
          <HeaderRow qsConfig={QS_CONFIG}>
            <HeaderCell sortKey="name">{t`Name`}</HeaderCell>
            <HeaderCell>{t`Organization`}</HeaderCell>
            <HeaderCell>{t`Description`}</HeaderCell>
          </HeaderRow>
        }
        renderRow={(team, index) => (
          <UserTeamListItem
            key={team.id}
            value={team.name}
            team={team}
            detailUrl={`/teams/${team.id}/details`}
            onSelect={() => handleSelect(team)}
            isSelected={selected.some((row) => row.id === team.id)}
            rowIndex={index}
          />
        )}
        renderToolbar={(props) => (
          <DataListToolbar
            {...props}
            isAllSelected={isAllSelected}
            onSelectAll={selectAll}
            qsConfig={QS_CONFIG}
            additionalControls={[
              ...(canAdd
                ? [
                    <ToolbarAddButton
                      key="associate"
                      onClick={() => setIsModalOpen(true)}
                      defaultLabel={t`Associate`}
                    />,
                  ]
                : []),
              <DisassociateButton
                key="disassociate"
                onDisassociate={handleDisassociate}
                itemsToDisassociate={selected}
                modalTitle={t`Disassociate related team(s)?`}
                modalNote={t`This action will disassociate all roles for this user from the selected teams.`}
              />,
            ]}
            emptyStateControls={
              canAdd ? (
                <ToolbarAddButton
                  key="add"
                  onClick={() => setIsModalOpen(true)}
                />
              ) : null
            }
          />
        )}
        toolbarSearchColumns={[
          {
            name: t`Name`,
            key: 'name__icontains',
            isDefault: true,
          },
          {
            name: t`Organization`,
            key: 'organization__name__icontains',
          },
        ]}
        toolbarSearchableKeys={searchableKeys}
        toolbarRelatedSearchableKeys={relatedSearchableKeys}
      />
      {isModalOpen && (
        <AssociateModal
          header={t`Teams`}
          fetchRequest={fetchTeamsToAssociate}
          isModalOpen={isModalOpen}
          onAssociate={handleAssociate}
          onClose={() => setIsModalOpen(false)}
          title={t`Select Teams`}
          optionsRequest={readTeamOptions}
        />
      )}
      {error && (
        <AlertModal
          isOpen={error}
          onClose={dismissError}
          title={t`Error!`}
          variant="error"
        >
          {associateError
            ? t`Failed to associate.`
            : t`Failed to disassociate one or more teams.`}
          <ErrorDetail error={error} />
        </AlertModal>
      )}
    </>
  );
}

export default UserTeamList;
