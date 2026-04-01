export const catalogQuery = `
  query Catalog {
    catalog {
      featured {
        id
        slug
        name
        format
        price
        inventoryOnHand
        authorName
        authorId
        seriesName
        seriesId
      }
      bestSellers {
        id
        slug
        name
        format
        price
        inventoryOnHand
        authorName
        authorId
        seriesName
        seriesId
      }
    }
  }
`;

export const titleQuery = `
  query Title($id: String!) {
    title(id: $id) {
      id
      slug
      name
      format
      price
      inventoryOnHand
      authorName
      authorId
      seriesName
      seriesId
      averageRating
      readingPreferences {
        fontFamily
        fontSize
        lineSpacing
        readerMode
        theme
        nightMode
        chineseMode
        updatedAt
      }
      chapters {
        id
        order
        name
        body
        bodySimplified
        bodyTraditional
      }
    }
  }
`;

export const communityQuery = `
  query CommunityThread($titleId: String!) {
    communityThread(titleId: $titleId) {
      titleId
      viewerHasFavorited
      viewerFollowsAuthor
      viewerFollowsSeries
      averageRating
      totalRatings
      comments {
        id
        authorId
        authorName
        commentType
        visibleBody
        createdAt
        replies {
          id
          authorId
          authorName
          commentType
          visibleBody
          createdAt
          replies {
            id
            authorId
            authorName
            commentType
            visibleBody
            createdAt
          }
        }
      }
    }
  }
`;

export const recommendationsQuery = `
  query Recommendations($titleId: String!) {
    recommendations(titleId: $titleId) {
      titleId
      reason
      recommendedTitleIds
      traceId
    }
  }
`;
